/* eslint-disable unicorn/prefer-https -- the POM namespace is an identifier that must read http://, not a URL that is fetched */
import { CHECKSTYLE_CONFIG_PATH, JAVA_RELEASE, MAVEN_AGGREGATOR_VERSION, MAVEN_VERSIONS } from './java-build.config'

/**
 * The three Java project kinds.
 *
 * @remarks
 * They differ in where they live and whether they build an executable jar.
 *
 * @typeParam None - this type has no generic type parameters.
 */
export type JavaKind = 'java-app' | 'java-lib' | 'java-internal-lib'

/**
 * A name reduced to lowercase letters and digits.
 *
 * @param value - Any text, or nothing.
 * @returns The text lowercased with every other character removed; empty for nothing.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function lowercaseWord (value: string | undefined): string {
  return (value ?? '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '')
}

/**
 * The Maven `groupId` a workspace's modules share, from its git origin.
 *
 * @remarks
 * A reversed host and the organisation (`github.com/Acme/tools` is `com.github.acme`), which is what Maven Central asks a
 * namespace to be. With no origin there is nothing to derive it from and `com.example` is used, to be changed by hand; the
 * Go kinds fall back the same way.
 *
 * @param prefix - The repository's `<host>/<org>/<repo>` path, as the Go module prefix is, or `undefined`.
 * @returns A lowercase dotted package prefix with no empty segment.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function javaGroupId (prefix: string | undefined): string {
  const [host, organisation] = (prefix ?? '').split('/', 2)
  const segments = [...(host ?? '').split('.').reverse().map(part => lowercaseWord(part)), lowercaseWord(organisation)].filter(Boolean)

  return segments.length >= 2 ? segments.join('.') : 'com.example'
}

/**
 * The package segment a project's code lives in: its name with everything that is not a letter or digit removed.
 *
 * @remarks
 * A Java package is a path of identifiers, and `my-tool` is not one. The slice check derives the same segment from the
 * module's `artifactId`, which is the name as typed.
 *
 * @param name - The project name.
 * @returns A lowercase identifier.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function javaPackageSegment (name: string): string {
  const segment = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '')

  return /^\d/.test(segment) ? `_${segment}` : segment
}

/**
 * The aggregator `pom.xml` at the workspace root: shared plugin and library versions, and the list of modules.
 *
 * @remarks
 * Maven has no workspace file of its own, so the root `pom.xml` is both the parent every module inherits its plugin and
 * test-library versions from and the reactor that lets `mvn -pl <module> -am` build a module with the siblings it depends
 * on. It is mnci's, as `go.work` and the root `Cargo.toml` are: a module is added to it when a project is.
 *
 * @param groupId - The workspace's `groupId`.
 * @param modules - The workspace-relative module directories.
 * @returns The text of `pom.xml`.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function javaRootPom (groupId: string, modules: readonly string[]): string {
  const v = MAVEN_VERSIONS

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>${groupId}</groupId>
  <artifactId>workspace</artifactId>
  <version>${MAVEN_AGGREGATOR_VERSION}</version>
  <packaging>pom</packaging>

  <properties>
    <maven.compiler.release>${JAVA_RELEASE}</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>

  <modules>
${modules.map(module => `    <module>${module}</module>`).join('\n')}
  </modules>

  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.junit</groupId>
        <artifactId>junit-bom</artifactId>
        <version>${v.junit}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>

  <build>
    <pluginManagement>
      <plugins>
        <plugin>
          <artifactId>maven-compiler-plugin</artifactId>
          <version>${v.compiler}</version>
          <configuration>
            <showWarnings>true</showWarnings>
            <failOnWarning>true</failOnWarning>
            <compilerArgs>
              <arg>-Xlint:all</arg>
            </compilerArgs>
          </configuration>
        </plugin>
        <plugin>
          <artifactId>maven-surefire-plugin</artifactId>
          <version>${v.surefire}</version>
        </plugin>
        <plugin>
          <artifactId>maven-jar-plugin</artifactId>
          <version>${v.jar}</version>
        </plugin>
        <plugin>
          <artifactId>maven-shade-plugin</artifactId>
          <version>${v.shade}</version>
        </plugin>
        <plugin>
          <artifactId>maven-checkstyle-plugin</artifactId>
          <version>${v.checkstyle}</version>
          <configuration>
            <configLocation>${CHECKSTYLE_CONFIG_PATH}</configLocation>
          </configuration>
          <dependencies>
            <dependency>
              <groupId>com.puppycrawl.tools</groupId>
              <artifactId>checkstyle</artifactId>
              <version>${v.engine}</version>
            </dependency>
          </dependencies>
        </plugin>
      </plugins>
    </pluginManagement>
  </build>
</project>
`
}

/**
 * Adds a module to the aggregator `pom.xml`, once.
 *
 * @remarks
 * Idempotent: a module that is already listed is left alone, so adding the same project twice changes nothing.
 *
 * @param text - The text of the root `pom.xml`.
 * @param directory - The module's workspace-relative directory.
 * @returns The text with the module listed.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addMavenModule (text: string, directory: string): string {
  if (text.includes(`<module>${directory}</module>`)) {
    return text
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'

  return text.replace(/^([ \t]*)<\/modules>/m, (_whole, indent: string) => `${indent}  <module>${directory}</module>${newline}${indent}</modules>`)
}

/**
 * A module's `pom.xml`.
 *
 * @remarks
 * Inherits every plugin and test-library version from the aggregator, so it names none. An app shades its dependencies into
 * one runnable jar named after the project (`<name>.jar`), because the sibling libraries it uses are separate jars that
 * `java -jar` would not find. A library is a plain jar.
 *
 * @param kind - Which Java kind.
 * @param groupId - The workspace's `groupId`.
 * @param name - The project name, which is the `artifactId`.
 * @param entryPoint - The app's main class, when the project has one.
 * @returns The text of the module's `pom.xml`.
 * @throws Never - pure string building.
 * @typeParam None - this function has no generic type parameters.
 */
export function javaModulePom (kind: JavaKind, groupId: string, name: string, entryPoint: string | undefined): string {
  const directory = `\${project.basedir}/../../dist/maven/${name}`
  const shade = kind === 'java-app'
    ? `
    <finalName>${name}</finalName>
    <plugins>
      <plugin>
        <artifactId>maven-shade-plugin</artifactId>
        <executions>
          <execution>
            <phase>package</phase>
            <goals>
              <goal>shade</goal>
            </goals>
            <configuration>
              <createDependencyReducedPom>false</createDependencyReducedPom>
              <transformers>
                <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
                  <mainClass>${entryPoint ?? ''}</mainClass>
                </transformer>
              </transformers>
            </configuration>
          </execution>
        </executions>
      </plugin>
    </plugins>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>${groupId}</groupId>
    <artifactId>workspace</artifactId>
    <version>${MAVEN_AGGREGATOR_VERSION}</version>
    <relativePath>../../pom.xml</relativePath>
  </parent>

  <groupId>${groupId}</groupId>
  <artifactId>${name}</artifactId>
  <version>0.1.0</version>
  <packaging>jar</packaging>

  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <!-- Build output stays out of the source tree, with the other kinds' (dist/target, dist/cmake). -->
    <directory>${directory}</directory>${shade}
  </build>
</project>
`
}

/**
 * The source files of a Java project's worked example, as paths relative to the project to contents.
 *
 * @remarks
 * The Java mapping of the vertical-slice rules: a package is the slice (`<group>.<project>.greeting`), the role is in the
 * type name because Java names a file for its one public type (`GreetUseCase.java`, `GreetingContract.java`, as C# does),
 * and `Main` only wires. The test sits in the same package under `src/test/java`, which is Maven's layout. Written so
 * `-Xlint:all` and the Checkstyle rules pass: braces always, every parameter `final`.
 *
 * @param kind - Which Java kind.
 * @param groupId - The workspace's `groupId`.
 * @param name - The project name, which an app greets.
 * @returns The files to write.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function javaExampleFiles (kind: JavaKind, groupId: string, name: string): Record<string, string> {
  const base = `${groupId}.${javaPackageSegment(name)}`
  const directory = base.replaceAll('.', '/')
  const slice = `${directory}/greeting`
  const files: Record<string, string> = {
    [`src/main/java/${slice}/GreetingContract.java`]: `package ${base}.greeting;

/**
 * What greeting someone returns.
 *
 * @param message The greeting text.
 */
public record GreetingContract(String message) {
}
`,
    [`src/main/java/${slice}/GreetUseCase.java`]: `package ${base}.greeting;

/** Greets a name; a blank one is greeted as a stranger. */
public final class GreetUseCase {
  private GreetUseCase() {
  }

  /**
   * Greets a name.
   *
   * @param name Who to greet.
   * @return The greeting.
   */
  public static GreetingContract greet(final String name) {
    final String who = name == null || name.isBlank() ? "stranger" : name.strip();

    return new GreetingContract("Hello, " + who + "!");
  }
}
`,
    [`src/test/java/${slice}/GreetUseCaseTest.java`]: `package ${base}.greeting;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class GreetUseCaseTest {
  @Test
  void greetsAName() {
    assertEquals("Hello, Ada!", GreetUseCase.greet("Ada").message());
  }

  @Test
  void greetsABlankNameAsAStranger() {
    assertEquals("Hello, stranger!", GreetUseCase.greet("   ").message());
  }
}
`,
  }
  if (kind === 'java-app') {
    files[`src/main/java/${directory}/Main.java`] = `package ${base};

import ${base}.greeting.GreetUseCase;

/** Entry point: wires the use case to the console. */
public final class Main {
  private Main() {
  }

  /**
   * Prints the greeting.
   *
   * @param args Unused.
   */
  public static void main(final String[] args) {
    System.out.println(GreetUseCase.greet("${name}").message());
  }
}
`
  }

  return files
}

/**
 * What `mnci add java-app|java-lib --empty` writes: an entry point that does nothing, or no source at all.
 *
 * @remarks
 * A library has no source file, as a bare C# class library has none; the first slice is the first package you add (#330).
 * There is no test, and Surefire passes with none.
 *
 * @param kind - Which Java kind.
 * @param groupId - The workspace's `groupId`.
 * @param name - The project name.
 * @returns The files to write.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function javaEmptyFiles (kind: JavaKind, groupId: string, name: string): Record<string, string> {
  if (kind !== 'java-app') {
    return {}
  }
  const base = `${groupId}.${javaPackageSegment(name)}`

  return {
    [`src/main/java/${base.replaceAll('.', '/')}/Main.java`]: `package ${base};

/** Entry point. */
public final class Main {
  private Main() {
  }

  /**
   * Does nothing yet.
   *
   * @param args Unused.
   */
  public static void main(final String[] args) {
    // Intentionally empty.
  }
}
`,
  }
}
