#!/usr/bin/env python3
# For exporting Python based Pocket DB to a JSON file for use with Pocket-JS
"""
Created on Fri Apr 21 21:03:55 2017
@author: pnbrown
"""

import pickle
import util.db as db
DB = db.Mist_DB()
DB.to_json('db.json')