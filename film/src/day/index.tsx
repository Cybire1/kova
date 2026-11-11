import { loadFont } from '@remotion/fonts'
import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot, staticFile } from 'remotion'
import { FPS } from '../motion'
import { fontsReady } from '../theme'
import { DURATION, Film } from './Film'

const mono = loadFont({ family: 'JetBrains Mono', url: staticFile('fonts/JetBrainsMono-Medium.woff2'), weight: '500' })

function Video() {
  const [handle] = useState(() => delayRender('Local Kova fonts'))
  useEffect(() => {
    Promise.all([fontsReady, mono]).then(() => continueRender(handle))
  }, [handle])
  return <Film />
}

function Root() {
  return <Composition id="AllOfIt" component={Video} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={1920} height={1080} />
}

registerRoot(Root)
