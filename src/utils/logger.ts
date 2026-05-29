type Level = 'INFO' | 'WARN' | 'ERROR' | 'ALERT';

function stamp(): string {
  return new Date().toISOString();
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const base = `[${stamp()}] [${level}] ${msg}`;
  if (meta && Object.keys(meta).length > 0) {
    console.log(base, JSON.stringify(meta));
  } else {
    console.log(base);
  }
}

export const log = {
  info:  (msg: string, meta?: Record<string, unknown>) => emit('INFO',  msg, meta),
  warn:  (msg: string, meta?: Record<string, unknown>) => emit('WARN',  msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('ERROR', msg, meta),
  alert: (msg: string, meta?: Record<string, unknown>) => emit('ALERT', msg, meta),
};
