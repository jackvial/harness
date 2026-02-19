#!/usr/bin/env node

import { ensureBunAvailable } from './bun-runtime-guard.js';

if (!ensureBunAvailable()) {
  process.exit(1);
}
