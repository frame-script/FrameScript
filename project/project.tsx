import { useAnimation, useVariable } from "../src/lib/animation"
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
import { Clip } from "../src/lib/clip"
import { seconds } from "../src/lib/frame"
import { FillFrame } from "../src/lib/layout/fill-frame"
import { Code } from "../src/lib/misc/code"
import { Project, type ProjectSettings } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"

export const PROJECT_SETTINGS: ProjectSettings = {
  name: "framescript-template",
  width: 1920,
  height: 1080,
  fps: 60,
}

const CODE_STEPS = [
  {
    language: "ts" as const,
    code: `type User = { id: string; first: string; last: string }

export const fetchUser = async (id: string) => {
  const res = await fetch(\`/api/users/\${id}\`)
  return res.json()
}`,
  },
  {
    language: "ts" as const,
    code: `type User = { id: string; first: string; last: string }

export const fetchUser = async (id: string): Promise<User> => {
  const res = await fetch(\`/api/users/\${id}\`)
  if (!res.ok) {
    throw new Error("request failed")
  }
  return res.json()
}`,
  },
  {
    language: "ts" as const,
    code: `type User = { id: string; first: string; last: string }

export const fetchUser = async (id: string): Promise<User> => {
  const res = await fetch(\`/api/users/\${id}\`)
  if (!res.ok) {
    throw new Error("request failed")
  }
  const user = await res.json() as User
  return user
}`,
  },
  {
    language: "ts" as const,
    code: `type User = { id: string; first: string; last: string; fullName: string }

export const fetchUser = async (id: string): Promise<User> => {
  const res = await fetch(\`/api/users/\${id}\`)
  if (!res.ok) {
    throw new Error("request failed")
  }
  const user = await res.json() as Omit<User, "fullName">
  const fullName = \`\${user.first} \${user.last}\`
  return { ...user, fullName }
}`,
  },
]

const CodeScene = () => {
  const codeStep = useVariable(0)
  const focusStep = useVariable(0)
  const panelOpacity = useVariable(0)
  const panelOffset = useVariable(50)

  useAnimation(async (ctx) => {
    await ctx.parallel([
      ctx.move(panelOpacity).to(1, seconds(0.7), BEZIER_SMOOTH),
      ctx.move(panelOffset).to(0, seconds(0.7), BEZIER_SMOOTH),
    ])

    await ctx.sleep(seconds(0.2))

    await ctx.parallel([
      ctx.move(codeStep).to(1, seconds(1.7), BEZIER_SMOOTH),
      ctx.move(focusStep).to(1, seconds(1.7), BEZIER_SMOOTH),
    ])

    await ctx.sleep(seconds(0.3))

    await ctx.parallel([
      ctx.move(codeStep).to(2, seconds(1.8), BEZIER_SMOOTH),
      ctx.move(focusStep).to(2, seconds(1.8), BEZIER_SMOOTH),
    ])

    await ctx.sleep(seconds(0.3))

    await ctx.parallel([
      ctx.move(codeStep).to(3, seconds(2.0), BEZIER_SMOOTH),
      ctx.move(focusStep).to(3, seconds(2.0), BEZIER_SMOOTH),
    ])

    await ctx.sleep(seconds(0.6))

    await ctx.parallel([
      ctx.move(panelOpacity).to(0, seconds(0.8), BEZIER_SMOOTH),
      ctx.move(panelOffset).to(-30, seconds(0.8), BEZIER_SMOOTH),
    ])
  }, [])

  return (
    <FillFrame
      style={{
        alignItems: "center",
        justifyContent: "center",
        background:
          "radial-gradient(circle at 20% 20%, rgba(56,189,248,0.12), transparent 45%), radial-gradient(circle at 80% 80%, rgba(14,165,233,0.08), transparent 40%), #020617",
      }}
    >
      <div
        style={{
          width: 1480,
          maxWidth: "92%",
          padding: 22,
          borderRadius: 18,
          background: "linear-gradient(180deg, rgba(15,23,42,0.94), rgba(2,6,23,0.94))",
          border: "1px solid rgba(56,189,248,0.28)",
          boxShadow: "0 28px 70px rgba(2,6,23,0.65)",
          transform: `translateY(${panelOffset.use()}px)`,
          opacity: panelOpacity.use(),
        }}
      >
        <div
          style={{
            marginBottom: 14,
            color: "#bae6fd",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "0.02em",
            fontFamily: "'Fira Sans', 'Noto Sans JP', sans-serif",
          }}
        >
          Code Step Demo
        </div>

        <Code
          steps={CODE_STEPS}
          step={codeStep}
          fontSize={30}
          lineHeight={1.55}
          padding={18}
          theme={{
            base: "#dbeafe",
            keyword: "#7dd3fc",
            type: "#fca5a5",
            string: "#86efac",
            number: "#fbbf24",
            comment: "#94a3b8",
            builtin: "#c4b5fd",
            punctuation: "#cbd5e1",
          }}
          highlightTracks={[
            {
              id: "main-focus",
              step: focusStep,
              steps: [
                {
                  codeStep: 0,
                  match: "await fetch(`/api/users/${id}`)",
                  padding: { x: 14, y: 5 },
                  radius: 12,
                  strokeWidth: 3,
                  color: "#22d3ee",
                  fillColor: "rgba(34,211,238,0.12)",
                },
                {
                  codeStep: 1,
                  match: "if (!res.ok) {\n    throw new Error(\"request failed\")\n  }",
                  padding: { x: 14, y: 5 },
                  radius: 12,
                  strokeWidth: 3,
                  color: "#f59e0b",
                  fillColor: "rgba(245,158,11,0.12)",
                },
                {
                  codeStep: 2,
                  match: "const user = await res.json() as User",
                  padding: { x: 14, y: 5 },
                  radius: 12,
                  strokeWidth: 3,
                  color: "#a78bfa",
                  fillColor: "rgba(167,139,250,0.14)",
                },
                {
                  codeStep: 3,
                  match: "return { ...user, fullName }",
                  padding: { x: 14, y: 5 },
                  radius: 12,
                  strokeWidth: 3,
                  color: "#34d399",
                  fillColor: "rgba(52,211,153,0.14)",
                },
              ],
            },
          ]}
        />
      </div>
    </FillFrame>
  )
}

export const PROJECT = () => {
  return (
    <Project>
      <TimeLine>
        <Clip label="Code Demo">
          <CodeScene />
        </Clip>
      </TimeLine>
    </Project>
  )
}
