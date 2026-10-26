importScripts('music.js');
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, result: VoicingMusic.findVoicings(data.chord, data.options) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
