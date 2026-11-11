import { useEffect, useState } from 'react'
import { Composition, Still, continueRender, delayRender, registerRoot } from 'remotion'
import { fontsReady } from '../theme'
import { Design } from './Design'
import { IOS_LIVE_FRAMES, IosLiveFilm } from './IosLiveFilm'

function Frame({ shot }: { shot: 'opening' | 'impact' | 'end' }) {
  const [handle] = useState(() => delayRender('Kova Manrope'))
  useEffect(() => { fontsReady.then(() => continueRender(handle)) }, [handle])
  return <Design shot={shot} />
}

function Film() {
  const [handle] = useState(() => delayRender('Kova Manrope'))
  useEffect(() => { fontsReady.then(() => continueRender(handle)) }, [handle])
  return <IosLiveFilm />
}

function Root() {
  return <>
    <Composition id="IosLive" component={Film} fps={30} width={1920} height={1080} durationInFrames={IOS_LIVE_FRAMES} />
    {(['opening', 'impact', 'end'] as const).map((shot) => <Still key={shot} id={`IosLive-${shot}`} component={Frame} width={1920} height={1080} defaultProps={{ shot }} />)}
  </>
}

registerRoot(Root)
