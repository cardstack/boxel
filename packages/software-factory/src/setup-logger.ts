import { configureLogger } from './logger.ts';

configureLogger(process.env.LOG_LEVELS || '*=info');
