/** Its own entry, so the film's Root (tracked in git) stays as submitted. */
import { Composition, registerRoot } from 'remotion'
import { FPS, TWO_SENDS_DURATION, TwoSendsFilm } from './TwoSendsFilm'

function Root() {
  return (
    <>
      <Composition
        id="TwoSendsFilm"
        component={TwoSendsFilm}
        durationInFrames={TWO_SENDS_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
      />
      {/* The same film with the narrator; the picture is identical, so only its sound is rendered. */}
      <Composition
        id="TwoSendsVoice"
        component={TwoSendsFilm}
        defaultProps={{ voice: true }}
        durationInFrames={TWO_SENDS_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  )
}

registerRoot(Root)
