/** Its own entry, so the film's Root (tracked in git) stays as submitted. */
import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { fontsReady } from '../theme'
import { WALL_FRAMES, WallScreen } from './WallScreen'
import { WallStage } from './WallStage'

function Fonts({ children }: { children: React.ReactNode }) {
  const [h] = useState(() => delayRender('fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(h))
  }, [h])
  return <>{children}</>
}

const Screen = () => (
  <Fonts>
    <WallScreen />
  </Fonts>
)

function Root() {
  return (
    <>
      <Composition id="WallScreen" component={Screen} durationInFrames={WALL_FRAMES} fps={30} width={3000} height={1000} />
      <Composition id="WallStage" component={WallStage} durationInFrames={WALL_FRAMES} fps={30} width={1920} height={1080} />
    </>
  )
}

registerRoot(Root)
