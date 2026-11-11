import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { FPS } from '../motion'
import { fontsReady } from '../theme'
import { DURATION, Film } from './Film'

function Video() {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  return <Film />
}

function Root() {
  return (
    <Composition
      id="CashOut"
      component={Video}
      durationInFrames={Math.round(DURATION * FPS)}
      fps={FPS}
      width={1920}
      height={1080}
    />
  )
}

registerRoot(Root)
