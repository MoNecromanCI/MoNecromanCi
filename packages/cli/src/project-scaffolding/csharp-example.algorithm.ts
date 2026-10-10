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

/**
 * The example use case's xunit test, for the sibling `<identity>.Tests` project.
 *
 * @remarks
 * `Xunit` is a global using in the `dotnet new xunit` project file, so the file needs
 * only the namespace of the project under test.
 *
 * @param identity - The tested project's PascalCase identity, which is its root namespace.
 * @returns The C# source.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function csharpExampleTest (identity: string): string {
  return `using ${identity};

public class GreetUseCaseTests
{
    [Fact]
    public void GreetsAName()
    {
        Assert.Equal("Hello, world!", GreetUseCase.Greet("world").Message);
    }
}
`
}

/**
 * The one test of a C# project scaffolded with `--empty`: the test project runs.
 *
 * @remarks
 * `dotnet test` over a test project with no tests is a warning in some SDK versions and a failure in others, and a test
 * project that is wired to nothing would not be noticed until the first real test. This is the smallest honest test, and
 * the first real one replaces it (#330).
 *
 * @param None - this function takes no parameters.
 * @returns The text of `SmokeTests.cs`.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function csharpEmptyTest (): string {
  return `public class SmokeTests
{
    [Fact]
    public void TheTestProjectRuns()
    {
        Assert.True(true);
    }
}
`
}
