/** Its own entry, so the film's Root (tracked in git) stays as submitted. */
import { Composition, registerRoot } from 'remotion'
import { FPS, HEIGHT, UGC_DURATION, UgcFilm, WIDTH } from './UgcFilm'

function Root() {
  return <Composition id="UgcFilm" component={UgcFilm} durationInFrames={UGC_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
}

registerRoot(Root)
