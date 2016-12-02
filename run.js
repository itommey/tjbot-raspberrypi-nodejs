var Promise = require('bluebird');
var watson = require('watson-developer-cloud');
var config = require('./config.js')
var exec = require('child_process').exec;
var fs = require('fs');
var mic = require('mic');
var player = require('play-sound')(opts = {})

var attentionWord = config.attentionWord;

/******************************************************************************
* Step #1: Create Watson Services
*******************************************************************************/
var speechToText = watson.speech_to_text({
  username: config.STTUsername,
  password: config.STTPassword,
  version: 'v1'
});

var toneAnalyzer = watson.tone_analyzer({
  username: config.ToneUsername,
  password: config.TonePassword,
  version: 'v3',
  version_date: '2016-05-19'
});

var conversation = watson.conversation({
  username: config.ConUsername,
  password: config.ConPassword,
  version: 'v1',
  version_date: '2016-07-11'
});

var textToSpeech = watson.text_to_speech({
  username: config.TTSUsername,
  password: config.TTSPassword,
  version: 'v1'
});

/******************************************************************************
* Step #2: Configuring the Microphone
*******************************************************************************/
var micParams = { 
  'rate': '44100', 
  'channels': '2', 
  'debug': false, 
  'exitOnSilence': 6
}
var micInstance = mic(micParams);
var micInputStream = micInstance.getAudioStream();
micInputStream.on('pauseComplete', ()=> {
  console.log('Got SIGNAL pauseComplete');
  setTimeout(function() {
      micInstance.resume();
  }, 3000); //Stop listening when speaker is talking
});

micInstance.start();
console.log('TJ is listening, you may speak now.');

/******************************************************************************
* Step #3: Speech To Text
*******************************************************************************/
var textStream = micInputStream.pipe(speechToText.createRecognizeStream({
  content_type: 'audio/l16; rate=44100; channels=2',
  interim_results: true,
  smart_formatting: true,
})).setEncoding('utf8');

/******************************************************************************
* Step #4: Get Tone Emotion
*******************************************************************************/
var getEmotion = (text) => {
  return new Promise((resolve) => {
    var maxScore = 0;
    var emotion = null;
    toneAnalyzer.tone({text: text}, (err, tone) => {
      var tones = tone.document_tone.tone_categories[0].tones;
      for (var i=0; i<tones.length; i++) {
        if (tones[i].score > maxScore){
          maxScore = tones[i].score;
          emotion = tones[i].tone_id;
        }
      }
      resolve({emotion, maxScore});
    })
  })
};

/******************************************************************************
* Step #5: Text To Speech
*******************************************************************************/
var speakResponse = (text) => {
  var params = {
    text: text,
    voice: config.voice,
    accept: 'audio/wav'
  };
  textToSpeech.synthesize(params)
  .pipe(fs.createWriteStream('output.wav'))
  .on('close', () => {
    micInstance.pause();
    player.play('output.wav');
  });
}

/******************************************************************************
* Step #6: Conversation
******************************************************************************/
var dialog_on = false;
var context = {};
var watson_response = '';

textStream.on('data', (user_speech) => {
  user_speech = user_speech.toLowerCase();
  console.log('Watson hears: ', user_speech);
  if (user_speech.indexOf(attentionWord.toLowerCase()) >= 0){
    dialog_on = true
  }

  if (dialog_on) {
    getEmotion(user_speech).then((detectedEmotion) => {
      context.emotion = detectedEmotion.emotion;
      console.log('Detected Emotion: ', 
                  detectedEmotion.emotion, 
                  detectedEmotion.maxScore);
      conversation.message({
        workspace_id: config.ConWorkspace,
        input: {'text': user_speech},
        context: context
      }, (err, response) => {
        context = response.context;
        watson_response =  response.output.text[0]  ;
        speakResponse(watson_response);
        console.log('Watson says:', watson_response);
      });
    });  
  } else {
    console.log('Waiting to hear the word '', attentionWord, ''');
  }
});
