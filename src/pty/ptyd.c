#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <util.h>
#else
#include <pty.h>
#endif

enum {
  OPCODE_DATA = 0x01,
  OPCODE_RESIZE = 0x02,
  OPCODE_CLOSE = 0x03
};

struct parser {
  uint8_t *buf;
  size_t len;
  size_t cap;
};

static int parser_init(struct parser *p, size_t cap) {
  p->buf = (uint8_t *)malloc(cap);
  if (p->buf == NULL) {
    return -1;
  }
  p->len = 0;
  p->cap = cap;
  return 0;
}

static void parser_deinit(struct parser *p) {
  free(p->buf);
  p->buf = NULL;
  p->len = 0;
  p->cap = 0;
}

static int parser_append(struct parser *p, const uint8_t *data, size_t n) {
  if (n == 0) {
    return 0;
  }

  if (p->len + n > p->cap) {
    size_t next_cap = p->cap * 2;
    while (next_cap < p->len + n) {
      next_cap *= 2;
    }
    uint8_t *next = (uint8_t *)realloc(p->buf, next_cap);
    if (next == NULL) {
      return -1;
    }
    p->buf = next;
    p->cap = next_cap;
  }

  memcpy(p->buf + p->len, data, n);
  p->len += n;
  return 0;
}

static void parser_consume(struct parser *p, size_t n) {
  if (n >= p->len) {
    p->len = 0;
    return;
  }
  memmove(p->buf, p->buf + n, p->len - n);
  p->len -= n;
}

static int write_all(int fd, const uint8_t *buf, size_t len) {
  size_t off = 0;
  while (off < len) {
    ssize_t n = write(fd, buf + off, len - off);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      return -1;
    }
    off += (size_t)n;
  }
  return 0;
}

static int signal_child(pid_t pid, int sig) {
  pid_t pgid = getpgid(pid);
  if (pgid < 0) {
    return -1;
  }

  if (pgid == pid) {
    if (killpg(pgid, sig) < 0) {
      return -1;
    }
    return 0;
  }

  if (kill(pid, sig) < 0) {
    return -1;
  }
  return 0;
}

static int parse_and_apply_frames(struct parser *p, int master_fd, pid_t child_pid) {
  while (p->len > 0) {
    uint8_t opcode = p->buf[0];
    if (opcode == OPCODE_DATA) {
      if (p->len < 5) {
        return 0;
      }
      uint32_t n = ((uint32_t)p->buf[1] << 24) |
                   ((uint32_t)p->buf[2] << 16) |
                   ((uint32_t)p->buf[3] << 8) |
                   ((uint32_t)p->buf[4]);
      if (p->len < (size_t)(5 + n)) {
        return 0;
      }
      if (n > 0) {
        if (write_all(master_fd, p->buf + 5, n) != 0) {
          return -1;
        }
      }
      parser_consume(p, (size_t)(5 + n));
      continue;
    }

    if (opcode == OPCODE_RESIZE) {
      if (p->len < 5) {
        return 0;
      }
      uint16_t cols = (uint16_t)(((uint16_t)p->buf[1] << 8) | p->buf[2]);
      uint16_t rows = (uint16_t)(((uint16_t)p->buf[3] << 8) | p->buf[4]);
      struct winsize ws;
      memset(&ws, 0, sizeof(ws));
      ws.ws_col = cols;
      ws.ws_row = rows;
      if (ioctl(master_fd, TIOCSWINSZ, &ws) != 0) {
        return -1;
      }
      (void)signal_child(child_pid, SIGWINCH);
      parser_consume(p, 5);
      continue;
    }

    if (opcode == OPCODE_CLOSE) {
      (void)signal_child(child_pid, SIGHUP);
      parser_consume(p, 1);
      continue;
    }

    parser_consume(p, 1);
  }
  return 0;
}

static int child_exit_code(int status) {
  if (WIFEXITED(status)) {
    return WEXITSTATUS(status);
  }
  if (WIFSIGNALED(status)) {
    return 128 + WTERMSIG(status);
  }
  return 1;
}

int main(int argc, char **argv) {
  if (argc < 2) {
    return 2;
  }

  int master_fd = -1;
  int slave_fd = -1;
  if (openpty(&master_fd, &slave_fd, NULL, NULL, NULL) != 0) {
    return 1;
  }

  pid_t pid = fork();
  if (pid < 0) {
    close(master_fd);
    close(slave_fd);
    return 1;
  }

  if (pid == 0) {
    if (setsid() < 0) {
      _exit(1);
    }
    if (ioctl(slave_fd, TIOCSCTTY, 0) < 0) {
      _exit(1);
    }

    if (dup2(slave_fd, STDIN_FILENO) < 0) {
      _exit(1);
    }
    if (dup2(slave_fd, STDOUT_FILENO) < 0) {
      _exit(1);
    }
    if (dup2(slave_fd, STDERR_FILENO) < 0) {
      _exit(1);
    }

    close(master_fd);
    close(slave_fd);

    execvp(argv[1], &argv[1]);
    _exit(127);
  }

  close(slave_fd);

  struct parser p;
  if (parser_init(&p, 8192) != 0) {
    close(master_fd);
    return 1;
  }

  bool stdin_open = true;
  uint8_t io_buf[65536];

  for (;;) {
    int status = 0;
    pid_t waited = waitpid(pid, &status, WNOHANG);
    if (waited == pid) {
      parser_deinit(&p);
      close(master_fd);
      return child_exit_code(status);
    }

    fd_set readfds;
    FD_ZERO(&readfds);
    if (stdin_open) {
      FD_SET(STDIN_FILENO, &readfds);
    }
    FD_SET(master_fd, &readfds);
    int maxfd = master_fd > STDIN_FILENO ? master_fd : STDIN_FILENO;

    struct timeval tv;
    tv.tv_sec = 0;
    tv.tv_usec = 100000;
    int sel = select(maxfd + 1, &readfds, NULL, NULL, &tv);
    if (sel < 0) {
      if (errno == EINTR) {
        continue;
      }
      parser_deinit(&p);
      close(master_fd);
      return 1;
    }

    if (stdin_open && FD_ISSET(STDIN_FILENO, &readfds)) {
      ssize_t n = read(STDIN_FILENO, io_buf, sizeof(io_buf));
      if (n == 0) {
        stdin_open = false;
      } else if (n < 0) {
        if (errno != EINTR) {
          stdin_open = false;
        }
      } else {
        if (parser_append(&p, io_buf, (size_t)n) != 0) {
          parser_deinit(&p);
          close(master_fd);
          return 1;
        }
        if (parse_and_apply_frames(&p, master_fd, pid) != 0) {
          parser_deinit(&p);
          close(master_fd);
          return 1;
        }
      }
    }

    if (FD_ISSET(master_fd, &readfds)) {
      ssize_t n = read(master_fd, io_buf, sizeof(io_buf));
      if (n == 0) {
        int status = 0;
        (void)waitpid(pid, &status, 0);
        parser_deinit(&p);
        close(master_fd);
        return child_exit_code(status);
      }
      if (n < 0) {
        if (errno == EINTR) {
          continue;
        }
        parser_deinit(&p);
        close(master_fd);
        return 1;
      }
      if (write_all(STDOUT_FILENO, io_buf, (size_t)n) != 0) {
        parser_deinit(&p);
        close(master_fd);
        return 1;
      }
    }
  }
}
