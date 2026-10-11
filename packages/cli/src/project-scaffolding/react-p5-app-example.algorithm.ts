import { reactAppExampleFiles } from './react-app-example.algorithm'

/**
 * The worked example `mnci add react-p5-app` writes: the React greeting feature plus a `bouncing-ball` slice drawn with p5.
 *
 * @remarks
 * The slice shows where each part of a p5 sketch lives under the role vocabulary, with no new role. The motion is
 * arithmetic, so it is an `.algorithm.ts` that a plain spec covers. Drawing is the adapter to an external engine,
 * which is what `.client.ts` is for; its spec hands it a recording stand-in for the p5 instance, so no canvas is
 * needed. The React wrapper (`P5Canvas`) is a `.component.tsx`. `App` composes both features.
 *
 * Written without template literals inside the generated text, so it needs no escaping.
 *
 * @param name - The project name, which the app greets.
 * @returns The files to write, keyed by path under `src/`.
 * @throws Never - pure object construction.
 * @typeParam None - this function has no generic type parameters.
 */
export function reactP5AppExampleFiles (name: string): Record<string, string> {
  return {
    ...reactAppExampleFiles(name),
    'bouncing-ball/ball.contract.ts': `/** A ball moving inside a rectangle. */
export interface Ball {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly radius: number
}

/** The rectangle a ball bounces inside. */
export interface Bounds {
  readonly width: number
  readonly height: number
}
`,
    'bouncing-ball/step-ball.algorithm.ts': `import type { Ball, Bounds } from './ball.contract'

/**
 * Moves a ball one frame and turns it around when it reaches an edge. Pure, so it needs no canvas to test.
 */
export function stepBall (ball: Ball, bounds: Bounds): Ball {
  let { x, y, vx, vy } = ball
  x += vx
  y += vy
  if (x < ball.radius || x > bounds.width - ball.radius) {
    vx = -vx
    x = Math.min(Math.max(x, ball.radius), bounds.width - ball.radius)
  }
  if (y < ball.radius || y > bounds.height - ball.radius) {
    vy = -vy
    y = Math.min(Math.max(y, ball.radius), bounds.height - ball.radius)
  }

  return { ...ball, x, y, vx, vy }
}
`,
    'bouncing-ball/step-ball.algorithm.spec.ts': `import { stepBall } from './step-ball.algorithm'

const bounds = { width: 100, height: 50 }

describe('stepBall', () => {
  it('moves the ball by its velocity', () => {
    const next = stepBall({ x: 10, y: 10, vx: 2, vy: 3, radius: 5 }, bounds)

    expect(next).toMatchObject({ x: 12, y: 13, vx: 2, vy: 3 })
  })

  it('turns around at the right edge and stays inside', () => {
    const next = stepBall({ x: 94, y: 10, vx: 4, vy: 0, radius: 5 }, bounds)

    expect(next.vx).toBe(-4)
    expect(next.x).toBe(95)
  })

  it('turns around at the top edge', () => {
    const next = stepBall({ x: 50, y: 6, vx: 0, vy: -3, radius: 5 }, bounds)

    expect(next.vy).toBe(3)
    expect(next.y).toBe(5)
  })
})
`,
    'bouncing-ball/bouncing-ball.client.ts': `import type { Sketch } from '@p5-wrapper/react'
import type { Ball } from './ball.contract'
import { stepBall } from './step-ball.algorithm'

const bounds = { width: 480, height: 320 }

const start: Ball = { x: 80, y: 60, vx: 3, vy: 2, radius: 24 }

/**
 * The p5 sketch: the adapter between p5's drawing loop and the pure motion in \`stepBall\`.
 */
export const bouncingBallSketch: Sketch = p5 => {
  let ball = start

  p5.setup = () => {
    p5.createCanvas(bounds.width, bounds.height)
  }

  p5.draw = () => {
    ball = stepBall(ball, bounds)
    p5.background(240)
    p5.noStroke()
    p5.fill(30, 120, 200)
    p5.circle(ball.x, ball.y, ball.radius * 2)
  }
}
`,
    'bouncing-ball/bouncing-ball.client.spec.ts': `import { bouncingBallSketch } from './bouncing-ball.client'

type Instance = Parameters<typeof bouncingBallSketch>[0]

/** A stand-in for the p5 instance that records what the sketch draws, so no canvas is involved. */
function recordingInstance () {
  const calls: string[] = []
  const instance = {
    setup: () => {},
    draw: () => {},
    createCanvas: (width: number, height: number) => { calls.push('canvas ' + width + 'x' + height) },
    background: () => { calls.push('background') },
    noStroke: () => {},
    fill: () => {},
    circle: (x: number, y: number, diameter: number) => { calls.push('circle ' + x + ',' + y + ' d=' + diameter) },
  }

  return { instance, calls }
}

describe('bouncingBallSketch', () => {
  it('creates a canvas on setup', () => {
    const { instance, calls } = recordingInstance()
    bouncingBallSketch(instance as unknown as Instance)
    instance.setup()

    expect(calls).toEqual(['canvas 480x320'])
  })

  it('moves the ball and draws it on every frame', () => {
    const { instance, calls } = recordingInstance()
    bouncingBallSketch(instance as unknown as Instance)
    instance.draw()
    instance.draw()

    expect(calls).toEqual(['background', 'circle 83,62 d=48', 'background', 'circle 86,64 d=48'])
  })
})
`,
    'bouncing-ball/bouncing-ball.component.tsx': `import { P5Canvas } from '@p5-wrapper/react'
import { Suspense } from 'react'

import { bouncingBallSketch } from './bouncing-ball.client'

/**
 * The wrapper loads p5 lazily, so it sits in a Suspense boundary of its own: the rest of the page (the greeting)
 * shows at once instead of waiting for the sketch.
 */
export function BouncingBall () {
  return (
    <Suspense fallback={<p>Loading the sketch</p>}>
      <P5Canvas sketch={bouncingBallSketch} />
    </Suspense>
  )
}
`,
    'bouncing-ball/index.ts': `export * from './ball.contract'
export * from './step-ball.algorithm'
export * from './bouncing-ball.component'
`,
    'app/app.component.tsx': `import { BouncingBall } from '../bouncing-ball'
import { GreetingView } from '../greeting'

export function App () {
  return (
    <main>
      <GreetingView name='${name}' />
      <BouncingBall />
    </main>
  )
}

export default App
`,
  }
}
