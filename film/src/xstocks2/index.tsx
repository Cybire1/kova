import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { fontsReady } from '../theme'
import { DURATION, FPS, XStocks2 } from './Film'

function Video() {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  return <XStocks2 />
}

function Root() {
  return <Composition id="XStocks2" component={Video} durationInFrames={DURATION} fps={FPS} width={1920} height={1080} />
}

registerRoot(Root)
