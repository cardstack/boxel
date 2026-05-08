import { configureLogger } from './logger';

configureLogger(process.env.LOG_LEVELS || '*=info');
