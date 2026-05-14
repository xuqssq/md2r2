import chalk from 'chalk';

function timestamp() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `.${pad(now.getMilliseconds(), 3)}`
  );
}

function write(stream, prefix, message) {
  stream.write(`${chalk.gray(`[${timestamp()}]`)} ${prefix} ${message}\n`);
}

export const logger = {
  info(message) {
    write(process.stdout, chalk.cyan('INFO '), message);
  },
  success(message) {
    write(process.stdout, chalk.green('OK   '), message);
  },
  warn(message) {
    write(process.stdout, chalk.yellow('WARN '), message);
  },
  error(message) {
    write(process.stderr, chalk.red('ERROR'), message);
  },
  step(message) {
    write(process.stdout, chalk.magenta('STEP '), chalk.bold(message));
  },
  skip(message) {
    write(process.stdout, chalk.gray('SKIP '), chalk.gray(message));
  },
};
