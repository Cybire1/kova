import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot } from 'remotion'
import { fontsReady } from '../theme'
import { loadFont } from '@remotion/fonts'
import { staticFile } from 'remotion'
import { DURATION, Film, FPS } from './Film'

const mono = loadFont({ family: 'JetBrains Mono', url: staticFile('fonts/JetBrainsMono-Medium.woff2'), weight: '700' })

function Video() {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => {
    Promise.all([fontsReady, mono]).then(() => continueRender(handle))
  }, [handle])
  return <Film />
}

registerRoot(() => (
  <Composition id="ChromeBudget" component={Video} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={1920} height={1080} />
))
