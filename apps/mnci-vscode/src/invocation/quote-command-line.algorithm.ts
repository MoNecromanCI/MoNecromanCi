/** Characters that mean something to a POSIX shell, PowerShell or cmd, so a value holding one cannot be passed through safely. */
const UNSAFE = /["'`$&|;<>(){}*?!\r\n]/

/**
 * Quotes one argument for a terminal's command line.
 *
 * @remarks
 * Plain values go through as they are; one with whitespace is wrapped in double quotes, which
 * bash, PowerShell and cmd all read the same way. A value holding any shell metacharacter is
 * refused rather than escaped: the escaping differs per shell and this runs in whichever one
 * the user's terminal is, so a wrong guess would be a command injection. Project names and
 * scopes never need these characters.
 *
 * @param argument - One argument.
 * @returns The argument, quoted when it has whitespace.
 * @throws Error when the argument contains a shell metacharacter.
 * @typeParam None - this function has no generic type parameters.
 */
export function quoteArgument (argument: string): string {
  if (UNSAFE.test(argument)) {
    throw new Error(`"${argument}" holds characters that cannot be passed to a terminal safely.`)
  }

  return /\s/.test(argument) ? `"${argument}"` : argument
}

/**
 * Joins a command and its arguments into one line a terminal can run.
 *
 * @remarks
 * PowerShell will not run a quoted path without the call operator, so it is added when the
 * command needed quoting and the shell is PowerShell.
 *
 * @param command - The executable.
 * @param arguments_ - Its arguments.
 * @param shell - The terminal's shell executable (`vscode.env.shell`), when known.
 * @returns The command line.
 * @throws Error when any part contains a shell metacharacter.
 * @typeParam None - this function has no generic type parameters.
 */
export function buildCommandLine (command: string, arguments_: readonly string[], shell = ''): string {
  const quotedCommand = quoteArgument(command)
  const prefix = quotedCommand !== command && /pwsh|powershell/i.test(shell) ? '& ' : ''

  return `${prefix}${[quotedCommand, ...arguments_.map(argument => quoteArgument(argument))].join(' ')}`
}
