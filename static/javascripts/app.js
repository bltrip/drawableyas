//audio node variables
var context;
var convolver;
var compressor;
var masterGainNode;
var effectLevelNode;
var lowPassFilterNode;

var noteTime;
var startTime;
var lastDrawTime = -1;
var LOOP_LENGTH = 16;
var rhythmIndex = 0;
var timeoutId;
var testBuffer = null;

var currentKit = null;
var wave = null;
var reverbImpulseResponse = null;

var tempo = 120;
var TEMPO_MAX = 200;
var TEMPO_MIN = 40;
var TEMPO_STEP = 4;


var numPages;

if (window.hasOwnProperty('AudioContext') && !window.hasOwnProperty('webkitAudioContext')) {
  window.webkitAudioContext = AudioContext;
}

$(function () {
  init();
  addNewTrackEvent();
  playPauseListener();
  lowPassFilterListener();
  reverbListener();
  createLowPassFilterSliders();
  initializeTempo();
  changeTempoListener();
  search = initSearch();
});

function createLowPassFilterSliders() {
  $("#freq-slider").slider({
    value: 1,
    min: 0,
    max: 1,
    step: 0.01,
    disabled: true,
    slide: changeFrequency
  });
  $("#quality-slider").slider({
    value: 0,
    min: 0,
    max: 1,
    step: 0.01,
    disabled: true,
    slide: changeQuality
  });
}

function lowPassFilterListener() {
  $('#lpf').click(function () {
    $(this).toggleClass("active");
    $(this).blur();
    if ($(this).hasClass("btn-default")) {
      $(this).removeClass("btn-default");
      $(this).addClass("btn-warning");
      lowPassFilterNode.active = true;
      $("#freq-slider,#quality-slider").slider("option", "disabled", false);
    } else {
      $(this).addClass("btn-default");
      $(this).removeClass("btn-warning");
      lowPassFilterNode.active = false;
      $("#freq-slider,#quality-slider").slider("option", "disabled", true);
    }
  })
}

function reverbListener() {
  $("#reverb").click(function () {
    $(this).toggleClass("active");
    $(this).blur();
    if ($(this).hasClass("btn-default")) {
      $(this).removeClass("btn-default");
      $(this).addClass("btn-warning");
      convolver.active = true;
    } else {
      $(this).addClass("btn-default");
      $(this).removeClass("btn-warning");
      convolver.active = false;
    }
  })
}

function changeFrequency(event, ui) {
  var minValue = 40;
  var maxValue = context.sampleRate / 2;
  var numberOfOctaves = Math.log(maxValue / minValue) / Math.LN2;
  var multiplier = Math.pow(2, numberOfOctaves * (ui.value - 1.0));
  lowPassFilterNode.frequency.value = maxValue * multiplier;
}

function changeQuality(event, ui) {
  //30 is the quality multiplier, for now. 
  lowPassFilterNode.Q.value = ui.value * 30;
}

function CheckAndTrigerPlayPause() {
  var $span = $('#play-pause').children("span");
  if ($span.hasClass('glyphicon-play')) {
    $span.removeClass('glyphicon-play');
    $span.addClass('glyphicon-pause');
    handlePlay();
  } else {
    $span.addClass('glyphicon-play');
    $span.removeClass('glyphicon-pause');
    handleStop();
  }
}

// TODO: work on this space stuff
// Currently many keys are mapped to the play/pause button, and it avoids using them in the text inputes (space, arrows, delete, ...)
//$(window).keypress(function (e) {
//  if (e.charCode === 0 || e.charCode === 32) {
//    e.preventDefault();
//    CheckAndTrigerPlayPause();
//  }
//})

function playPauseListener() {
  $('#play-pause').click(function () {
    CheckAndTrigerPlayPause();
  });
}


function TranslateStateInActions(sequencerState) {
  var trackNames = sequencerState['trackNames'];
  var pads = sequencerState['pads'];
  var soundUrls = sequencerState['sounds'];
  var waves = sequencerState['waves'];
  
  // check if the tracks are already loaded
  if (sequencerState.trackNames.length != $('.instrument').length) {
    // Delete all existing tracks
    var numLocalTracks = $('.instrument').length;
    for (var i = numLocalTracks-1; i >= 0; i--) {
      deleteTrack(i);
    }
    
    // Add tracks and load buffers
    for (var j = 0; j < trackNames.length; j++) {
      addNewTrack(j, trackNames[j], soundUrls[j], waves[j][0], waves[j][1]);
    }

    // Activate pads
    for (var i = 0; i < trackNames.length; i++) {
      var trackTabs = pads[i];
      for (var j = 0; j < trackTabs.length; j++) {
        toggleSelectedListenerSocket(i, j, trackTabs[j]);
      }
    }
  }
}

function toggleSelectedListener(padEl) {
  padEl.toggleClass("selected");
  var trackId = padEl.parent().parent().index();
  var padClass = padEl.attr('class');
  var padId = padClass.split(' ')[1].split('_')[1];
  var padState = (padEl.hasClass("selected")) ? 1 : 0;
  return [trackId, padId, padState]
}

function toggleSelectedListenerSocket(trackId, padId, padState) {
  var padEl = $('.instrument').eq(trackId).children().children().eq(parseInt(padId) + 1);
  var currentState = padEl.hasClass("selected");
  if (currentState) {
    if (padState == 0) {
      padEl.removeClass("selected");
    }
  } else {
    if (padState == 1) {
      padEl.addClass("selected");
    }
  }
}


function init() {
  initializeAudioNodes();
  loadKits();
  loadImpulseResponses();
}

function initializeAudioNodes() {
  context = new webkitAudioContext();
  var finalMixNode;
  if (context.createDynamicsCompressor) {
    // Create a dynamics compressor to sweeten the overall mix.
    compressor = context.createDynamicsCompressor();
    compressor.connect(context.destination);
    finalMixNode = compressor;
  } else {
    // No compressor available in this implementation.
    finalMixNode = context.destination;
  }


  // Create master volume.
  // for now, the master volume is static, but in the future there will be a slider
  masterGainNode = context.createGain();
  masterGainNode.gain.value = 0.7; // reduce overall volume to avoid clipping
  masterGainNode.connect(finalMixNode);

  //connect all sounds to masterGainNode to play them

  //don't need this for now, no wet dry mix for effects
  // // Create effect volume.
  // effectLevelNode = context.createGain();
  // effectLevelNode.gain.value = 1.0; // effect level slider controls this
  // effectLevelNode.connect(masterGainNode);

  // Create convolver for effect
  convolver = context.createConvolver();
  convolver.active = false;
  // convolver.connect(effectLevelNode);

  //Create Low Pass Filter
  lowPassFilterNode = context.createBiquadFilter();
  //this is for backwards compatibility, the type used to be an integer
  lowPassFilterNode.type = (typeof lowPassFilterNode.type === 'string') ? 'lowpass' : 0; // LOWPASS
  //default value is max cutoff, or passing all frequencies
  lowPassFilterNode.frequency.value = context.sampleRate / 2;
  lowPassFilterNode.connect(masterGainNode);
  lowPassFilterNode.active = false;
}

function loadKits() {
  //name must be same as path
  var kit = new Kit("TR808");
  
  //TODO: figure out how to test if a kit is loaded
  currentKit = kit;
}

function loadImpulseResponses() {
  reverbImpulseResponse = new ImpulseResponse("sounds/impulse-responses/matrix-reverb2.wav");
  reverbImpulseResponse.load();
}


//TODO delete this
function loadTestBuffer() {
  var request = new XMLHttpRequest();
  var url = "http://www.freesound.org/data/previews/102/102130_1721044-lq.mp3";
  request.open("GET", url, true);
  request.responseType = "arraybuffer";

  request.onload = function () {
    context.decodeAudioData(
      request.response,
      function (buffer) {
        testBuffer = buffer;
      },
      function (buffer) {
        console.log("Error decoding drum samples!");
      }
    );
  }
  request.send();
}

//TODO delete this
function sequencePads() {
  $('.pad.selected').each(function () {
    $('.pad').removeClass("selected");
    $(this).addClass("selected");
  });
}

function playNote(buffer, noteTime, startTime, endTime) {
  var voice = context.createBufferSource();
  voice.buffer = buffer;
  
  var currentLastNode = masterGainNode;
  if (lowPassFilterNode.active) {
    lowPassFilterNode.connect(currentLastNode);
    currentLastNode = lowPassFilterNode;
  }
  if (convolver.active) {
    convolver.buffer = reverbImpulseResponse.buffer;
    convolver.connect(currentLastNode);
    currentLastNode = convolver;
  }

  voice.connect(currentLastNode);
  voice.start(noteTime, startTime, endTime-startTime);
}

function schedule() {
  var currentTime = context.currentTime;

  // The sequence starts at startTime, so normalize currentTime so that it's 0 at the start of the sequence.
  currentTime -= startTime;

  while (noteTime < currentTime + 0.200) {
    var contextPlayTime = noteTime + startTime;
    var $currentPads = $(".column_" + rhythmIndex);
    $currentPads.each(function () {
      if ($(this).hasClass("selected")) {
        var trackId = $(this).parents('.instrument').index();
        var wave = currentKit.waves[trackId];
        playNote(currentKit.buffers[trackId], contextPlayTime, wave.startTime, wave.endTime);
      }
    });
    if (noteTime != lastDrawTime) {
      lastDrawTime = noteTime;
      drawPlayhead(rhythmIndex);
    }
    advanceNote();
  }
  timeoutId = requestAnimationFrame(schedule)
}

function drawPlayhead(xindex) {
  var lastIndex = (xindex + LOOP_LENGTH - 1) % LOOP_LENGTH;

  //can change this to class selector to select a column
  var $newRows = $('.column_' + xindex);
  var $oldRows = $('.column_' + lastIndex);

  $newRows.addClass("playing");
  $oldRows.removeClass("playing");
}

function advanceNote() {
  // Advance time by a 16th note...
  // var secondsPerBeat = 60.0 / theBeat.tempo;
  //TODO CHANGE TEMPO HERE, convert to float
  tempo = Number($("#tempo-input").val());
  var secondsPerBeat = 60.0 / tempo;
  rhythmIndex++;
  if (rhythmIndex == LOOP_LENGTH) {
    rhythmIndex = 0;
  }

  //0.25 because each square is a 16th note
  noteTime += 0.25 * secondsPerBeat
  // if (rhythmIndex % 2) {
  //     noteTime += (0.25 + kMaxSwing * theBeat.swingFactor) * secondsPerBeat;
  // } else {
  //     noteTime += (0.25 - kMaxSwing * theBeat.swingFactor) * secondsPerBeat;
  // }

}

function handlePlay(event) {
  rhythmIndex = 0;
  noteTime = 0.0;
  startTime = context.currentTime + 0.005;
  schedule();
}

function handleStop(event) {
  cancelAnimationFrame(timeoutId);
  $(".pad").removeClass("playing");
}

function initializeTempo() {
  $("#tempo-input").val(tempo);
}

function changeTempoListener() {
  $("#increase-tempo").click(function () {
    if (tempo < TEMPO_MAX) {
      tempo += TEMPO_STEP;
      $("#tempo-input").val(tempo);
    }
  });

  $("#decrease-tempo").click(function () {
    if (tempo > TEMPO_MIN) {
      tempo -= TEMPO_STEP;
      $("#tempo-input").val(tempo);
    }
  });
}

function trackNameExist() {
  var instru = $('.instrument');
  var trackName = $('#newTrackName').val();
  var duplicate = false;
  instru.each(function(index){
   if(trackName === $(this).attr('data-instrument')){
    duplicate = true;
   }
  });
  return duplicate;
}

function addNewTrackEvent() {
  $('#addNewTrack').click(function () {
    var trackName = $('#newTrackName').val();
    var soundUrl = $('#newTrackUrl').val();
    var trackId = $('.instrument').length;
    // this action needs to be call in the same order in all clients in order to keep same order of tracks
    //addNewTrack(trackId, trackName, soundUrl);
    // send to server
    sendNewTrack(trackName, soundUrl);

  });
}

function addNewTrack(trackId, trackName, soundUrl, startTime=null, endTime=null) {
  var uniqueTrackId = Date.now();
  
  // create html
  var padEl = '<div class="pad column_0">\n\n</div>\n';

  for (var i = 1; i < 15; i++) {
    padEl = padEl + '<div class="pad column_' + i + '">\n\n</div>\n';
  }
  padEl = padEl + '<div class="pad column_15"></div>';
  
  var newTrack = '<div ondrop="drop(event)" ondragover="allowDrop(event)" ondragleave="exitDrop(event)" class="row instrument" data-instrument="' +
    trackName + 
    '"><div class="col-xs-2 col-lg-2"> <a data-toggle="collapse" aria-expanded="false" aria-controls="edit-' +
    uniqueTrackId +
    '" href="#edit-'+
    uniqueTrackId +
    '" class="instrument-label"><i class="glyphicon glyphicon-chevron-right"></i> <strong class="instrumentName">' +
    trackName +
    '</strong></a></div><div class="col-xs-9 col-lg-9">' +
    padEl +
    '</div><div class="col-xs-1 col-lg-1"><button class="deleteTrackButton btn btn-warning"><div class="glyphicon glyphicon-remove"></div></button></div><div id="edit-'+
    uniqueTrackId +
    '" class="edit-zone collapse"><div class="waveform-container"></div><div class="waveform-timeline"></div><button class="refreshWaveRegionButton btn btn-success"><i class="glyphicon glyphicon-refresh"></i></button></div></div></div>';

  var prevTrack = $('#newTrack');
  prevTrack.before(newTrack);
  
  thisTrack = $('.instrument').eq(trackId);
  
  // load wavesurfer visu
  currentKit.waves[trackId] = new Wave();
  var wave = currentKit.waves[trackId];
  var waveContainer = thisTrack.children().children('.waveform-container')[0];
  wave.init(thisTrack, waveContainer);
  addRefreshRegionEvent(trackId);

  // load the edit visu on the first collapse
  thisTrack.children('.edit-zone').on('shown.bs.collapse', function () {
    if (!wave.loadedAfterCollapse) { wave.reload(); }
  });
  
  // load buffer
  currentKit.loadSample(soundUrl, trackId);
  if (startTime) {
    wave.startTime = startTime;
    wave.endTime = endTime;
  }
  
  // add click events
  addPadClickEvent(socket, trackId);
  addDeleteTrackClickEvent(trackId);
  addRotateTriangleEvent(trackId);
}

function addDeleteTrackClickEvent(trackId) {
  var deleteButton = $('.instrument').eq(trackId).children().children(".deleteTrackButton")[0];
  $(deleteButton).click(function () {
    var trackId = $(this).parents('.instrument').index();
    // this action needs to be call in the same order in all clients in order to keep same order of tracks
    //deleteTrack(trackId);
    // send to serveur
    sendDeleteTrack(trackId);
  });
}

function deleteTrack(trackId) {
  // delete html
  $('.instrument').eq(trackId).remove();

  // delete buffer
  currentKit.buffers.splice(trackId, 1);
  
  // delete wave
  currentKit.waves.splice(trackId, 1);
}


// FREESOUND SEARCH
function initSearch() {
  var search = new Search();
  search.setToken();
  search.addButtonEvents();
  return search;
}

function Search() {
  var query = null;
  var page = null;
  var numPages = null;
  var numSounds = null;
  var sliderValue = null;
}

Search.prototype.setToken = function() {
  freesound.setToken("bs5DQrWNL9d8zrQl0ApCvcQqwg0gg8ytGE60qg5o");
};

Search.prototype.freesoundIframe = function(soundId) {
  return '<iframe frameborder="0" scrolling="no" src="https://freesound.org/embed/sound/iframe/' + soundId + '/simple/small/" width="375" height="30"></iframe>';
};

Search.prototype.searchFreesound = function(query, page, filter) {
  var self = this;
  
  self.query = query;
  self.page = page;
  self.filter = filter;
  var sort = "rating_desc";
  freesound.textSearch(query, {
      page: page,
      filter: filter,
      sort: sort,
      fields: 'id,name,url,previews',
    },
    function (sounds) {
      var msg = ""
      self.numSounds = sounds.count;
      self.numPages = Math.ceil(self.numSounds/15);
      var numSoundCurrentPage = sounds.results.length;
      for (i = 0; i < numSoundCurrentPage; i++) {
        var snd = sounds.getSound(i);
        msg += "<div>" + self.freesoundIframe(snd.id) + "<div class='drag-me' draggable='true' ondragstart='drag(event)' sound-url='" + snd.previews["preview-lq-mp3"] + "'>Drag</div></div>";
      }
      msg += "</ul>"
      document.getElementById("search-result-container").innerHTML = msg;
      $('#page').html(self.page+'/' + self.numPages);
      $('#next').removeAttr('disabled');
      if (self.page >= self.numPages) {
        $('#next').attr('disabled', 'disabled');
      } else {
        $('#next').removeAttr('disabled');
      }
      if (self.page === 1) {
        $('#previous').attr('disabled', 'disabled');
      } else {
        $('#previous').removeAttr('disabled');
      }
      document.getElementById('error').innerHTML = "";
    },
    function () {
      document.getElementById('error').innerHTML = "Error while searching...";
    }
  );
};

Search.prototype.addButtonEvents = function() {
  var self = this;
  $('#search-button').click(function () {
    self.searchEvent();
  });  
  $('#search-form').submit(function () {
    self.searchEvent();
  });
  

  $('#previous').click(function () {
    self.page -= 1;
    self.searchFreesound(self.query, self.page, self.filter);
  });

  $('#next').click(function () {
    self.page += 1;
    self.searchFreesound(self.query, self.page, self.filter);
  });
};

Search.prototype.searchEvent = function() {
    this.query = $('#search-query').val();
    this.sliderValue = $('#sampleDuration').val();
    // Slider sample duration value
    //  this.sliderDuration.on('slide', function(slideEvt){
    //    console.log('valeur du slider', this.sliderValue);
    // });
    var duration = "duration:[" + this.sliderValue.split(',')[0] + ".0 TO " + this.sliderValue.split(',')[1] + ".0]"
    this.searchFreesound(this.query, 1, duration);
};

// Drag and drop sounds
function allowDrop(ev) {
  ev.preventDefault();
  var target = ev.target;
  var trackEl = $(target).hasClass('row') ? $(target) : $(target).parents('.row');
  trackEl.addClass("drop-over");
}

function exitDrop(ev) {
  ev.preventDefault();
  var target = ev.target;
  var trackEl = $(target).hasClass('row') ? $(target) : $(target).parents('.row');
  trackEl.removeClass("drop-over");
}

function drag(ev) {
  currentSoundUrl = ev.target.getAttribute("sound-url");
  ev.dataTransfer.setData("text", "");
}

function drop(ev) {
  ev.preventDefault();
  var target = ev.target;
  var trackEl = $(target).hasClass('row') ? $(target) : $(target).parents('.row');
  var trackId = trackEl.index();
  currentKit.loadSample(currentSoundUrl, trackId);
  sendLoadSound(trackId, currentSoundUrl);
  trackEl.removeClass("drop-over");
}


// Wave visu
function addRefreshRegionEvent(trackId) {
  var refreshButton = $('.instrument').eq(trackId).children(".edit-zone").children(".refreshWaveRegionButton")[0];
  $(refreshButton).click(function () {
    var trackId = $(this).parents('.instrument').index();
    currentKit.waves[trackId].restartRegion();
    currentKit.waves[trackId].sendRegion();
  });
}

// show new track details
function addNewTrackDetails() {
  $('#trackDetails').fadeIn('slow');

  $('#addNewTrack').on('click', function() {
    $('#trackDetails').fadeOut('slow');
  });

    $('#newTrackName').keyup(function() {
      if($(this).val() != '') {
        $('#addNewTrack').removeAttr('disabled');
      }
      else {
        $('#addNewTrack').attr('disabled', 'disabled')
      }
    });
}

// enable/disable search button
$('#search-query').keyup(function() {
  if($(this).val() != '') {
    $('#search-button').removeAttr('disabled');
  }
  else {
    $('#search-button').attr('disabled', 'disabled')
  }
});

function addRotateTriangleEvent(trackId) {
  $(".instrument-label").click(function() {
    $('.instrument').eq(trackId).children().children().children(".glyphicon").toggleClass('rotation');
  });
}
