import type { StreamSessionStatusModel } from '../../stream-protocol.ts';
import type { AgentStatusProjectionInput } from '../agent-status-reducer.ts';
import { BaseAgentStatusReducer } from '../reducer-base.ts';

export class CritiqueStatusReducer extends BaseAgentStatusReducer {
  readonly agentType = 'critique';

  constructor() {
    super();
  }

  override project(_input: AgentStatusProjectionInput): StreamSessionStatusModel | null {
    return null;
  }
}
