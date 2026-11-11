import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { fontsReady } from '../theme'
import { DURATION, FPS, OyinFilm } from './Film'

function Video() {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  return <OyinFilm />
}

function Root() {
  return <Composition id="Oyin" component={Video} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
}

registerRoot(Root)
