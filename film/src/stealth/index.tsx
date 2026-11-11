import { loadFont } from '@remotion/fonts'
import { useEffect, useState } from 'react'
import { Composition, continueRender, delayRender, registerRoot, staticFile } from 'remotion'
import { FPS } from '../motion'
import { fontsReady } from '../theme'
import { DURATION, Film } from './Film'
import { Explainer, EXPLAINER_DURATION } from './Explainer'
import { Simple, SIMPLE_DURATION } from './Simple'

const mono = loadFont({ family: 'JetBrains Mono', url: staticFile('fonts/JetBrainsMono-Medium.woff2'), weight: '500' })

function Video({ light }: { light: boolean }) {
  const [handle] = useState(() => delayRender('Local fonts'))
  useEffect(() => {
    Promise.all([fontsReady, mono]).then(() => continueRender(handle))
  }, [handle])
  return <Film light={light} />
}

function Lesson() {
  const [handle] = useState(() => delayRender('Local fonts'))
  useEffect(() => {
    Promise.all([fontsReady, mono]).then(() => continueRender(handle))
  }, [handle])
  return <Explainer />
}

function Plain() {
  const [handle] = useState(() => delayRender('Local fonts'))
  useEffect(() => {
    Promise.all([fontsReady, mono]).then(() => continueRender(handle))
  }, [handle])
  return <Simple />
}

function Root() {
  return (
    <>
      <Composition id="Stealth" component={Video} defaultProps={{ light: false }} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={1920} height={1080} />
      <Composition id="StealthSimple" component={Plain} durationInFrames={Math.round(SIMPLE_DURATION * FPS)} fps={FPS} width={1920} height={1080} />
      <Composition id="StealthExplainer" component={Lesson} durationInFrames={Math.round(EXPLAINER_DURATION * FPS)} fps={FPS} width={1920} height={1080} />
      <Composition id="StealthLight" component={Video} defaultProps={{ light: true }} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={1920} height={1080} />
    </>
  )
}

registerRoot(Root)
