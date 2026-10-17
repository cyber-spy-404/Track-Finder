const spotifyUrlInfo = require("spotify-url-info")(fetch);

async function testAlbum() {
  const albumUrl = "https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa"; // Random album
  const details = await spotifyUrlInfo.getDetails(albumUrl);
  console.log("Album title:", details.preview?.title);
  console.log("Album artist:", details.preview?.artist);
  console.log("Album tracks:", details.tracks?.length);
  if (details.tracks?.[0]) {
    console.log("Track 1:", details.tracks[0].name, "by", details.tracks[0].artist);
  }
}

testAlbum();
