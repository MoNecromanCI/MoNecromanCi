/**
 * The worked example `mnci add csharp-*` writes over the `dotnet new` placeholder, as
 * file names to contents.
 *
 * @remarks
 * Two roles: `Greeting` (a contract: the data a call returns) and `GreetUseCase` (one
 * outcome). .NET names a file after the one type it holds, in PascalCase, so the role
 * is in the type name (`GreetUseCase`) and not a dotted suffix; the slice idea is the
 * same as in the other languages. Both sit in the project's root namespace, which is
 * the project's identity, so a consumer needs one `using`.
 *
 * @param identity - The project's PascalCase identity, which is its root namespace.
 * @returns The files to write, keyed by file name.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function csharpExampleFiles (identity: string): Record<string, string> {
  return {
    'Greeting.cs': `namespace ${identity};

/// <summary>What greeting someone returns.</summary>
public sealed record Greeting(string Message);
`,
    'GreetUseCase.cs': `namespace ${identity};

/// <summary>Greets someone by name: a worked example of a use case. Replace it with your own.</summary>
public static class GreetUseCase
{
    public static Greeting Greet(string name) => new("Hello, " + name + "!");
}
`,
  }
}

/**
 * The console app's `Program.cs`, which calls the example use case.
 *
 * @remarks
 * Top-level statements, as `dotnet new console` writes them. `System` is imported
 * implicitly by the template's `ImplicitUsings`.
 *
 * @param identity - The project's PascalCase identity, which is its root namespace.
 * @returns The C# source.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function csharpConsoleProgram (identity: string): string {
  return `using ${identity};

Console.WriteLine(GreetUseCase.Greet("world").Message);
`
}
