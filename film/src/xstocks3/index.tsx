import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { fontsReady } from '../theme'
import { DURATION, FPS, XStocks3 } from './Film'

function Video() {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  return <XStocks3 />
}

function Root() {
  return <Composition id="XStocks3" component={Video} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
}

registerRoot(Root)
