import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { fontsReady } from '../theme'
import { DURATION, StocksFilm } from './Film'

function Video() {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => {
    fontsReady.then(() => continueRender(handle))
  }, [handle])
  return <StocksFilm />
}

function Root() {
  return (
    <Composition id="StocksFilm" component={Video} durationInFrames={DURATION} fps={30} width={1920} height={1080} />
  )
}

registerRoot(Root)
