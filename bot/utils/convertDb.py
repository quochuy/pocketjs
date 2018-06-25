#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Created on Fri Apr 21 21:03:55 2017
@author: pnbrown
"""

import pickle
import util.db as db
DB = db.Mist_DB()
DB.to_json('db.json')