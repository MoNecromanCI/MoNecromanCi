/**
 * A C++ identifier made from a project name, for a CMake target, a namespace and a folder under `src/`.
 *
 * @remarks
 * A project name may hold a hyphen (`my-tool`), which an identifier cannot. The CMake project keeps the name as typed; the
 * target and the include folder use this. Lives here because `mnci install` links a sibling by the same target name the
 * scaffold gave it.
 *
 * @param name - The project name.
 * @returns The name with every run of characters that are not letters or digits as one underscore.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function cppIdentifier (name: string): string {
  return name.replaceAll(/[^a-z0-9]+/gi, '_').replace(/^(\d)/, '_$1')
}

/**
 * Adds a sibling library to a C++ project's `CMakeLists.txt`: `add_subdirectory` and `target_link_libraries`.
 *
 * @remarks
 * How an internal library is consumed. Each project configures on its own, so the consumer pulls the sibling's directory in
 * under its own build tree and links the target the scaffold named after it. The lines go at the end of the file, after the
 * consumer's own target is defined, and carry a comment so the next reader knows where they came from. Idempotent: a
 * sibling that is already added is left alone.
 *
 * @param text - The text of the consumer's `CMakeLists.txt`.
 * @param relativePath - The sibling's directory relative to the consumer's, forward-slashed.
 * @param siblingName - The sibling project's name.
 * @param projectName - The consumer project's name.
 * @returns The text with the sibling added; the same text when it was already there.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function addCmakeSibling (text: string, relativePath: string, siblingName: string, projectName: string): string {
  if (text.includes(`add_subdirectory(${relativePath} `)) {
    return text
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const block = [
    '',
    `# mnci: depends on ${siblingName}`,
    `add_subdirectory(${relativePath} \${CMAKE_BINARY_DIR}/${siblingName})`,
    `target_link_libraries(${cppIdentifier(projectName)} PRIVATE ${cppIdentifier(siblingName)})`,
    '',
  ].join(newline)

  return `${text.endsWith('\n') ? text : text + newline}${block}`
}
