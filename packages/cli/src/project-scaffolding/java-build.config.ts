/**
 * The Java release every module compiles for (`maven.compiler.release`).
 *
 * @remarks
 * An LTS. The JDK that builds it must be at least this; the hosted CI images ship Temurin 17, 21 and 25.
 */
export const JAVA_RELEASE = '21'

/**
 * The workspace-relative path of the Checkstyle rules every Java project is linted with.
 *
 * @remarks
 * Written by mnci beside the slice check, and named by the aggregator's `maven-checkstyle-plugin` configuration.
 */
export const CHECKSTYLE_CONFIG_PATH = 'tools/checkstyle.xml'

/**
 * The version every aggregator `pom.xml` carries.
 *
 * @remarks
 * Never released: only the modules are, and a module's `<parent>` names this one.
 */
export const MAVEN_AGGREGATOR_VERSION = '0.0.0'

/**
 * The Maven plugin and library versions the root `pom.xml` pins.
 *
 * @remarks
 * One place, in the root `pluginManagement` and `dependencyManagement`, so a module's `pom.xml` names a plugin or a test
 * library without a version and the workspace upgrades them together. Stable releases only (the compiler and jar plugins
 * have 4.x betas that are newer).
 */
export const MAVEN_VERSIONS = {
  compiler:   '3.16.0',
  surefire:   '3.6.0',
  jar:        '3.5.1',
  shade:      '3.6.2',
  checkstyle: '3.6.0',
  // The Checkstyle engine the plugin runs, which the plugin's own default (9.3) is far behind.
  engine:     '14.3.0',
  junit:      '6.1.3',
} as const

/**
 * The `tools/checkstyle.xml` every Java project's `lint` runs.
 *
 * @remarks
 * Checkstyle's own `sun_checks` and `google_checks` are style guides of thousands of findings on a plain project, so this
 * is the short list that catches real mistakes: imports, braces, an `equals` with no `hashCode`, and the naming the
 * language relies on. The compiler runs with `-Xlint:all` and `failOnWarning` as the first linter. Written by mnci and
 * rewritten by it: a rule a team wants is added with its own file and `-Dcheckstyle.config.location`.
 */
export const CHECKSTYLE_CONFIG = `<?xml version="1.0"?>
<!DOCTYPE module PUBLIC "-//Checkstyle//DTD Checkstyle Configuration 1.3//EN" "https://checkstyle.org/dtds/configuration_1_3.dtd">
<!-- Written by MoNecromanCI; mnci rewrites it, so local edits do not survive. -->
<module name="Checker">
  <property name="severity" value="error"/>
  <module name="NewlineAtEndOfFile"/>
  <module name="FileTabCharacter"/>
  <module name="TreeWalker">
    <module name="AvoidStarImport"/>
    <module name="UnusedImports"/>
    <module name="RedundantImport"/>
    <module name="EmptyBlock"/>
    <module name="NeedBraces"/>
    <module name="EqualsHashCode"/>
    <module name="PackageName"/>
    <module name="TypeName"/>
    <module name="MethodName"/>
    <module name="ConstantName"/>
    <module name="LocalVariableName"/>
    <module name="ParameterName"/>
  </module>
</module>
`
