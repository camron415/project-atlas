Pod::Spec.new do |s|
  s.name           = 'AtlasRealtimePlayback'
  s.version        = '1.0.0'
  s.summary        = 'Gapless PCM16 streaming playback for Atlas Path B'
  s.description    = 'AVAudioEngine-based realtime PCM playback'
  s.license        = 'MIT'
  s.author         = 'Atlas'
  s.homepage       = 'https://github.com/atlas'
  s.platform       = :ios, '16.4'
  s.swift_version  = '5.4'
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
end
