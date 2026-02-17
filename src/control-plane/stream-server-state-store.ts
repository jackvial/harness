interface StateStoreContext {
  readonly ownsStateStore: boolean;
  stateStoreClosed: boolean;
  readonly stateStore: {
    close(): void;
  };
}

export function closeOwnedStateStore(ctx: StateStoreContext): void {
  if (!ctx.ownsStateStore || ctx.stateStoreClosed) {
    return;
  }
  ctx.stateStore.close();
  ctx.stateStoreClosed = true;
}
