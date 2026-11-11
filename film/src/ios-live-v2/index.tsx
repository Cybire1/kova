import { useEffect, useState } from 'react'
import { Composition, Still, continueRender, delayRender, registerRoot } from 'remotion'
import { fontsReady } from '../theme'
import { LaunchStill } from './Still'
import { DURATION, Film } from './Film'

function Image({ shot }: { shot: 'device' | 'opening' | 'ending' }) {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => { fontsReady.then(() => continueRender(handle)) }, [handle])
  return <LaunchStill shot={shot} />
}

function Video() {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => { fontsReady.then(() => continueRender(handle)) }, [handle])
  return <Film />
}

function Root() {
  return <>
    <Composition id="IosLaunch" component={Video} durationInFrames={DURATION} fps={30} width={1920} height={1080} />
    {(['device', 'opening', 'ending'] as const).map((shot) => <Still key={shot} id={`IosLaunch-${shot}`} component={Image} width={1920} height={1080} defaultProps={{ shot }} />)}
  </>
}

registerRoot(Root)
