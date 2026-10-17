rootProject.name = "Track-Finder"
include(":slugyzeon-plugin")
project(":slugyzeon-plugin").projectDir = file("plugin")
include(":slugyzeon-main")
project(":slugyzeon-main").projectDir = file("main")
