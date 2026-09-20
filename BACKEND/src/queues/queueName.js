import config from '../config/config.js';

export function queueName(base) {
  return config.NODE_ENV === 'production' ? base : `${base}-${config.NODE_ENV}`;
}