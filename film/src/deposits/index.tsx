import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { fontsReady } from '../theme'
import { DURATION, Deposits } from './Film'

function Video() {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  return <Deposits />
}

function Root() {
  return <Composition id="Deposits" component={Video} durationInFrames={DURATION} fps={30} width={1920} height={1080} />
}

registerRoot(Root)
