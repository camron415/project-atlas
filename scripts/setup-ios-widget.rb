#!/usr/bin/env ruby
# Adds the AtlasWidgetExtension target to the Xcode project (one-time setup).
# Requires: gem install xcodeproj

require "xcodeproj"

ROOT = File.expand_path("../apps/mobile/ios", __dir__)
PROJECT_PATH = File.join(ROOT, "Atlas.xcodeproj")
WIDGET_DIR = "AtlasWidgetExtension"

project = Xcodeproj::Project.open(PROJECT_PATH)
return if project.targets.any? { |t| t.name == "AtlasWidgetExtension" }

app_target = project.targets.find { |t| t.name == "Atlas" }
abort "Atlas app target not found" unless app_target

widget_group = project.main_group.find_subpath(WIDGET_DIR, true)
widget_group.set_source_tree("<group>")

swift_ref = widget_group.new_file("AtlasWidgetExtension.swift")
info_ref = widget_group.new_file("Info.plist")
ent_ref = widget_group.new_file("AtlasWidgetExtension.entitlements")

widget_target = project.new_target(
  :app_extension,
  "AtlasWidgetExtension",
  :ios,
  "16.4",
  project.main_group,
  :swift
)

widget_target.product_type = "com.apple.product-type.app-extension"
widget_target.build_configurations.each do |config|
  config.build_settings["INFOPLIST_FILE"] = "#{WIDGET_DIR}/Info.plist"
  config.build_settings["CODE_SIGN_ENTITLEMENTS"] = "#{WIDGET_DIR}/AtlasWidgetExtension.entitlements"
  config.build_settings["PRODUCT_BUNDLE_IDENTIFIER"] = "com.camrontrost.atlas.widget"
  config.build_settings["PRODUCT_NAME"] = "AtlasWidgetExtension"
  config.build_settings["SWIFT_VERSION"] = "5.9"
  config.build_settings["IPHONEOS_DEPLOYMENT_TARGET"] = "16.4"
  config.build_settings["TARGETED_DEVICE_FAMILY"] = "1,2"
  config.build_settings["LD_RUNPATH_SEARCH_PATHS"] = "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"
end

widget_target.add_file_references([swift_ref])

embed_phase = app_target.copy_files_build_phases.find { |p| p.name == "Embed App Extensions" }
unless embed_phase
  embed_phase = app_target.new_copy_files_build_phase("Embed App Extensions")
  embed_phase.symbol_dst_subfolder_spec = :plug_ins
end
build_file = embed_phase.add_file_reference(widget_target.product_reference)
build_file.settings = { "ATTRIBUTES" => ["RemoveHeadersOnCopy"] }

app_target.add_dependency(widget_target)

project.save
puts "Added AtlasWidgetExtension widget target."
