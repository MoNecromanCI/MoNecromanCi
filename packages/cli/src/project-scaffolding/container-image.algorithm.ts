/**
 * The app kinds an image can be built for.
 *
 * @remarks
 * Azure Functions apps are not among them: their image is the Functions host's, with its own entry point.
 * @typeParam None - this type has no generic type parameters.
 */
export type ContainerTarget = 'node-app' | 'react-app' | 'go-app'

/**
 * Every {@link ContainerTarget}, for a message that lists them.
 *
 * @remarks
 * Kept beside the type so a kind added to one is added to the other.
 */
export const CONTAINER_TARGETS: readonly ContainerTarget[] = ['node-app', 'react-app', 'go-app']

/**
 * How one app becomes an image.
 *
 * @remarks
 * `contextDirectory` is workspace-relative and holds exactly what the image contains; `dependsOn` is the target
 * of the app that produces it. `publish` is the `host:container` mapping `start` uses, absent when the app listens
 * on nothing.
 * @typeParam None - this interface has no generic type parameters.
 */
export interface ContainerPlan {
  /** The text of the `Dockerfile`. */
  dockerfile:       string
  /** The text of `Dockerfile.dockerignore`, which BuildKit reads beside the Dockerfile. */
  dockerignore:     string
  /** The files the image copies from the container project's own `files/` directory, by name. */
  files:            Readonly<Record<string, string>>
  /** The workspace-relative directory used as the build context. */
  contextDirectory: string
  /** The app target that must run first, such as `prune` or `build-all`. */
  dependsOn:        string
  /** The `host:container` port mapping for `start`, when the app serves something. */
  publish?:         string
}

/** The nginx server block a React single-page app needs: every unknown path falls back to `index.html`. */
const NGINX_SPA = `server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
`

/**
 * Plans the image of a Node app: the pruned build output and its production dependencies.
 *
 * @param app - The app's directory name.
 * @param port - The port the app listens on, when it does.
 * @returns The plan.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function planNode (app: string, port: number | undefined): ContainerPlan {
  // The sample servers bind to HOST, which defaults to localhost: unreachable from outside a container, so a
  // published port would answer nothing.
  const portLines = port === undefined ? '' : `ENV HOST=0.0.0.0\nENV PORT=${port}\nEXPOSE ${port}\n`

  return {
    dockerfile: `# Written by MoNecromanCI. The build context is the app's pruned output (its manifest, lockfile and compiled
# code), so the image holds only what the app needs to run.
FROM node:24-alpine
WORKDIR /app
COPY . .
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
ENV NODE_ENV=production
${portLines}USER node
CMD ["node", "main.js"]
`,
    dockerignore:     'node_modules\n',
    files:            {},
    contextDirectory: `apps/${app}/dist`,
    dependsOn:        'prune',
    ...(port !== undefined && { publish: `${port}:${port}` }),
  }
}

/**
 * Plans the image of a React app: its production build behind nginx, with single-page-app routing.
 *
 * @param app - The app's directory name.
 * @returns The plan.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function planReact (app: string): ContainerPlan {
  return {
    dockerfile: `# Written by MoNecromanCI. The build context is the app's production build.
FROM nginx:1.27-alpine
COPY --from=files default.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
EXPOSE 80
`,
    dockerignore:     '',
    files:            { 'default.conf': NGINX_SPA },
    contextDirectory: `apps/${app}/dist`,
    dependsOn:        'build',
    publish:          '8080:80',
  }
}

/**
 * Plans the image of a Go app: its static linux binary on a distroless base.
 *
 * @param app - The app's directory name.
 * @param port - The port the app listens on, when it does.
 * @returns The plan.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
function planGo (app: string, port: number | undefined): ContainerPlan {
  return {
    dockerfile: `# Written by MoNecromanCI. The build context holds the app's static linux-amd64 binary from build-all.
FROM gcr.io/distroless/static-debian12:nonroot
COPY ${app} /app
${port === undefined ? '' : `EXPOSE ${port}\n`}ENTRYPOINT ["/app"]
`,
    dockerignore:     '',
    files:            {},
    contextDirectory: `dist/platforms/${app}/linux-amd64`,
    dependsOn:        'build-all',
    ...(port !== undefined && { publish: `${port}:${port}` }),
  }
}

/**
 * Plans how an app is built into an image.
 *
 * @remarks
 * One recipe per kind of app, each measured by building the image: a Node app's pruned output installed with
 * production dependencies, a React app's build served by nginx with `try_files` fallback, a Go app's static
 * binary on distroless. Azure Functions apps are not here: their image is the Functions host's, with its own
 * entry point, and is its own piece of work.
 *
 * @param target - The kind of app.
 * @param app - The app's directory name under `apps/`.
 * @param port - The port a Node or Go app listens on, when it does.
 * @returns The plan.
 * @throws Never - pure.
 * @typeParam None - this function has no generic type parameters.
 */
export function planContainer (target: ContainerTarget, app: string, port?: number): ContainerPlan {
  switch (target) {
    case 'node-app': {
      return planNode(app, port)
    }
    case 'react-app': {
      return planReact(app)
    }
    case 'go-app': {
      return planGo(app, port)
    }
  }
}
