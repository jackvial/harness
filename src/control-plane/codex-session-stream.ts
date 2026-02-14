import { connectControlPlaneStreamClient, type ControlPlaneStreamClient } from './stream-client.ts';
import type { ControlPlaneStreamServer } from './stream-server.ts';

interface BaseControlPlaneAddress {
  host: string;
  port: number;
  authToken?: string;
}

interface EmbeddedControlPlaneOptions {
  mode: 'embedded';
}

interface RemoteControlPlaneOptions extends BaseControlPlaneAddress {
  mode: 'remote';
}

type CodexControlPlaneMode = EmbeddedControlPlaneOptions | RemoteControlPlaneOptions;

interface OpenCodexControlPlaneSessionOptions {
  controlPlane: CodexControlPlaneMode;
  sessionId: string;
  args: string[];
  env: Record<string, string>;
  initialCols: number;
  initialRows: number;
  terminalForegroundHex?: string;
  terminalBackgroundHex?: string;
}

interface OpenCodexControlPlaneSessionResult {
  client: ControlPlaneStreamClient;
  close: () => Promise<void>;
}

interface OpenCodexControlPlaneSessionDependencies {
  startEmbeddedServer?: () => Promise<ControlPlaneStreamServer>;
}

export async function openCodexControlPlaneSession(
  options: OpenCodexControlPlaneSessionOptions,
  dependencies: OpenCodexControlPlaneSessionDependencies = {}
): Promise<OpenCodexControlPlaneSessionResult> {
  let controlPlaneAddress: BaseControlPlaneAddress;
  let embeddedServer: ControlPlaneStreamServer | null = null;
  if (options.controlPlane.mode === 'embedded') {
    const startEmbeddedServer = dependencies.startEmbeddedServer;
    if (startEmbeddedServer === undefined) {
      throw new Error('embedded mode requires a startEmbeddedServer dependency');
    }
    embeddedServer = await startEmbeddedServer();
    const embeddedAddress = embeddedServer.address();
    controlPlaneAddress = {
      host: '127.0.0.1',
      port: embeddedAddress.port
    };
  } else {
    controlPlaneAddress = options.controlPlane;
  }

  const clientConnectOptions: {
    host: string;
    port: number;
    authToken?: string;
  } = {
    host: controlPlaneAddress.host,
    port: controlPlaneAddress.port
  };
  if (controlPlaneAddress.authToken !== undefined) {
    clientConnectOptions.authToken = controlPlaneAddress.authToken;
  }
  const client = await connectControlPlaneStreamClient(clientConnectOptions);

  try {
    const startCommand: {
      type: 'pty.start';
      sessionId: string;
      args: string[];
      env: Record<string, string>;
      initialCols: number;
      initialRows: number;
      terminalForegroundHex?: string;
      terminalBackgroundHex?: string;
    } = {
      type: 'pty.start',
      sessionId: options.sessionId,
      args: options.args,
      env: options.env,
      initialCols: options.initialCols,
      initialRows: options.initialRows
    };
    if (options.terminalForegroundHex !== undefined) {
      startCommand.terminalForegroundHex = options.terminalForegroundHex;
    }
    if (options.terminalBackgroundHex !== undefined) {
      startCommand.terminalBackgroundHex = options.terminalBackgroundHex;
    }

    const startResult = await client.sendCommand(startCommand);
    if (startResult['sessionId'] !== options.sessionId) {
      throw new Error('control-plane pty.start returned unexpected session id');
    }

    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: options.sessionId
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: options.sessionId,
      sinceCursor: 0
    });
  } catch (error: unknown) {
    client.close();
    if (embeddedServer !== null) {
      await embeddedServer.close();
    }
    throw error;
  }

  return {
    client,
    close: async () => {
      try {
        await client.sendCommand({
          type: 'pty.close',
          sessionId: options.sessionId
        });
      } catch {
        // Best-effort close only.
      }
      client.close();
      if (embeddedServer !== null) {
        await embeddedServer.close();
      }
    }
  };
}
