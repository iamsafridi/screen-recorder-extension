#!/bin/bash
# Simple script to create placeholder icons using ImageMagick
# Install ImageMagick: brew install imagemagick

convert -size 16x16 xc:blue -fill white -pointsize 10 -gravity center -annotate +0+0 "📷" icon16.png
convert -size 48x48 xc:blue -fill white -pointsize 30 -gravity center -annotate +0+0 "📷" icon48.png
convert -size 128x128 xc:blue -fill white -pointsize 80 -gravity center -annotate +0+0 "📷" icon128.png
