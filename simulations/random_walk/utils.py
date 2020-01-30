#!/usr/bin/python3

import random
import sys

FLOAT_TOLERANCE = 1e-7
RANDOM_WALK_MAX_LENGTH = 2*10**4
RANDOM_WALK_STEP = 0.1

def floatEqual(a, b):
    return abs(a - b) <= FLOAT_TOLERANCE

def floatCloseInRW(a, b):
    return floatEqual(abs(a - b), RANDOM_WALK_STEP)

def randomWalk(seed, startingPosition):
    random.seed(seed)
    position = startingPosition
    for _ in range(RANDOM_WALK_MAX_LENGTH):
        step = RANDOM_WALK_STEP
        if random.randrange(0, 2) == 0:
            step = - RANDOM_WALK_STEP
        position += step
        yield position
