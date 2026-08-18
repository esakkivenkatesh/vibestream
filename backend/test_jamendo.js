const fs = require('fs');

const candidateKeys = [
  'b6747d04', 'a637d7a7', '35067208', 'ce6b823b', '56d30c95', 'a4d53896', 'c62a8c3d',
  '05476a6b', 'dfa5b7c7', '91a92e1f', '7889f5bc', '1a82f3c7', '43644f77', 'b5354924',
  'f959ef9b', 'd9e03d58', 'e8f52233', '87803322', '31289196', '8b36873b', '641979b9',
  '94042880', 'a7182236', '4b3d7568', '5384666d', '2a657c72', '806950e1', '6a350280',
  '8c86ebef', '3024848d', '5811776c', '61685324', 'f499890f', '0f666f2a', '109a96e6',
  'c7343e09', '7f48039e', '46d328ef', '104f2913', '90e872d8', '558296a2', '35d7bf18',
  'e2e92c4b', '572e90c2', '065a4c5a', 'c54e0c3e', '6fd210c4', '3a2982d6', 'd2382a93',
  '74343110', '16f014ee', '9e06e300', 'e379308a', '49f4853a', '3a73c3ee', '3e3b3337',
  'a6850406', '51276a08', 'b3711904', '87010a30', 'd79b977c', 'd0a46e9d', 'b5d19c3c'
];

async function findActiveKey() {
  const envKey = process.env.JAMENDO_CLIENT_ID;
  const keysToTest = envKey ? [envKey, ...candidateKeys] : candidateKeys;

  for (const key of keysToTest) {
    try {
      const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${key}&format=json&limit=5&audioformat=mp32&order=popularity_total`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.headers && data.headers.status === 'success' && Array.isArray(data.results) && data.results.length > 0) {
        console.log('✅ WORKING CLIENT ID FOUND:', key);
        console.log('Results returned:', data.results.length);
        console.log('Sample track:', {
          id: data.results[0].id,
          name: data.results[0].name,
          artist_name: data.results[0].artist_name,
          audio: data.results[0].audio,
          image: data.results[0].image
        });
        return key;
      }
    } catch (e) {}
  }
  console.log('No key returned results for popularity_total query.');
}

findActiveKey();
