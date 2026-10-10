/**
 * The worked example of a Vue app: a `greeting` feature (contract, use case, component, specs) composed by the root
 * component.
 *
 * @remarks
 * The Vue mapping of the vertical-slice rules, as for the React and Angular apps: the feature is a folder with a barrel,
 * the root component only composes it, and Nx's welcome page is gone. Single-file components are named for their role,
 * `<name>.component.vue`. Paths are relative to the app's `src/`.
 *
 * @param name - The app's project name, shown in the greeting.
 * @returns The files to write, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function vueAppExampleFiles (name: string): Record<string, string> {
  return {
    'greeting/greeting.contract.ts': [
      '/** What greeting someone returns. */',
      'export interface Greeting {',
      '  message: string',
      '}',
      '',
    ].join('\n'),
    'greeting/greet.use-case.ts': [
      "import type { Greeting } from './greeting.contract'",
      '',
      '/** Greets someone by name: a worked example of a use case. Replace it with your own. */',
      'export function greet (name: string): Greeting {',
      '  return { message: `Hello, ${name}!` }',
      '}',
      '',
    ].join('\n'),
    'greeting/greet.use-case.spec.ts': [
      "import { greet } from './greet.use-case'",
      '',
      "describe('greet', () => {",
      "  it('greets by name', () => {",
      "    expect(greet('world')).toEqual({ message: 'Hello, world!' })",
      '  })',
      '})',
      '',
    ].join('\n'),
    'greeting/greeting.component.vue': [
      '<script setup lang="ts">',
      "import { computed } from 'vue'",
      "import { greet } from './greet.use-case'",
      '',
      'const properties = defineProps<{ name: string }>()',
      'const greeting = computed(() => greet(properties.name))',
      '</script>',
      '',
      '<template>',
      '  <h1>{{ greeting.message }}</h1>',
      '</template>',
      '',
    ].join('\n'),
    'greeting/index.ts': [
      "export { default as GreetingComponent } from './greeting.component.vue'",
      "export { greet } from './greet.use-case'",
      "export type { Greeting } from './greeting.contract'",
      '',
    ].join('\n'),
    'app/app.component.vue': [
      '<script setup lang="ts">',
      "import { GreetingComponent } from '../greeting'",
      '</script>',
      '',
      '<template>',
      `  <GreetingComponent name="${name}" />`,
      '</template>',
      '',
    ].join('\n'),
    'app/app.component.spec.ts': [
      "import { mount } from '@vue/test-utils'",
      "import AppComponent from './app.component.vue'",
      '',
      "describe('App', () => {",
      "  it('renders the greeting', () => {",
      `    expect(mount(AppComponent).find('h1').text()).toBe('Hello, ${name}!')`,
      '  })',
      '})',
      '',
    ].join('\n'),
  }
}

/**
 * What `mnci add vue-app --empty` writes: a root component with nothing in it.
 *
 * @remarks
 * No feature and no greeting; the one spec checks that the component mounts, because a runner with no tests exits
 * non-zero.
 *
 * @param None - this function takes no parameters.
 * @returns The files to write, keyed by path relative to `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function vueAppEmptyFiles (): Record<string, string> {
  return {
    'app/app.component.vue':     ['<template>', '  <div />', '</template>', ''].join('\n'),
    'app/app.component.spec.ts': [
      "import { mount } from '@vue/test-utils'",
      "import AppComponent from './app.component.vue'",
      '',
      "describe('App', () => {",
      "  it('mounts', () => {",
      '    expect(mount(AppComponent).exists()).toBe(true)',
      '  })',
      '})',
      '',
    ].join('\n'),
  }
}
