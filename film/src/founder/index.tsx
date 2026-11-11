/** Its own entry, so the film's Root (tracked in git) stays as submitted. */
import { Composition, registerRoot } from 'remotion'
import { FOUNDER_DURATION, FounderFilm, FPS, HEIGHT, WIDTH } from './FounderFilm'

function Root() {
  return <Composition id="FounderFilm" component={FounderFilm} durationInFrames={FOUNDER_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
}

registerRoot(Root)
