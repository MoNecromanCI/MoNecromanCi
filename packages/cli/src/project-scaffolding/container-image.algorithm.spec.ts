import { planContainer } from './container-image.algorithm'

describe('planContainer', () => {
  it('builds a Node app from its pruned output, runs as a non-root user and exposes its port when it has one', () => {
    const plan = planContainer('node-app', 'api', 3000)

    expect(plan.contextDirectory).toBe('apps/api/dist')
    expect(plan.dependsOn).toBe('prune')
    expect(plan.dockerfile).toContain('FROM node:24-alpine')
    expect(plan.dockerfile).toContain('npm install --omit=dev')
    expect(plan.dockerfile).toContain('USER node')
    expect(plan.dockerfile).toContain('EXPOSE 3000')
    expect(plan.dockerfile).toContain('ENV HOST=0.0.0.0')
    expect(plan.publish).toBe('3000:3000')
  })

  it('leaves out the port lines for a Node app that listens on nothing', () => {
    const plan = planContainer('node-app', 'worker')

    expect(plan.dockerfile).not.toContain('EXPOSE')
    expect(plan.dockerfile).not.toContain('ENV PORT')
    expect(plan.dockerfile).not.toContain('ENV HOST')
    expect(plan.publish).toBeUndefined()
  })

  it('serves a React app behind nginx with every unknown path falling back to index.html', () => {
    const plan = planContainer('react-app', 'web')

    expect(plan.dockerfile).toContain('FROM nginx:')
    expect(plan.dockerfile).toContain('COPY --from=files default.conf')
    expect(plan.files['default.conf']).toContain('try_files $uri $uri/ /index.html;')
    expect(plan.contextDirectory).toBe('apps/web/dist')
    expect(plan.dependsOn).toBe('build')
    expect(plan.publish).toBe('8080:80')
  })

  it('puts a Go app\'s static linux binary on a distroless base', () => {
    const plan = planContainer('go-app', 'cli', 8080)

    expect(plan.contextDirectory).toBe('dist/platforms/cli/linux-amd64')
    expect(plan.dependsOn).toBe('build-all')
    expect(plan.dockerfile).toContain('FROM gcr.io/distroless/static')
    expect(plan.dockerfile).toContain('COPY cli /app')
    expect(plan.dockerfile).toContain('ENTRYPOINT ["/app"]')
  })
})
