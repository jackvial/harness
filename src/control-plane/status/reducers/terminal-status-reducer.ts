import type { StreamSessionStatusModel } from '../../stream-protocol.ts';
import type { AgentStatusProjectionInput } from '../agent-status-reducer.ts';
import { BaseAgentStatusReducer } from '../reducer-base.ts';

export class TerminalStatusReducer extends BaseAgentStatusReducer {
  readonly agentType = 'terminal';

  constructor() {
    super();
  }

  override project(_input: AgentStatusProjectionInput): StreamSessionStatusModel | null {
    return null;
  }
}
