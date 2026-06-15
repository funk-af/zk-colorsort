pragma circom 2.1.6;

// Sound/complete Color-Sort circuit for this game profile:
// - 12 tubes, capacity 4
// - colors encoded as 1..NCOLORS, empty = 0
// - initial board is PUBLIC and validated in-circuit
// - private move sequence is hidden, with public moveCount = sum(active)
// - move semantics match the app: pour the maximal contiguous top run
//   (capped by destination room), not single-block pour.

include "circomlib/circuits/comparators.circom";  // IsZero, IsEqual, LessThan
include "circomlib/circuits/gates.circom";        // AND, OR

// Pull one tube's CAP slots from flattened state using dynamic index.
template TubeSelect(NTUBES, CAP) {
    signal input state[NTUBES * CAP];
    signal input idx;
    signal output slots[CAP];

    component eq[NTUBES];
    signal part[NTUBES][CAP];
    signal acc[NTUBES + 1][CAP];

    for (var i = 0; i < CAP; i++) {
        acc[0][i] <== 0;
    }

    for (var t = 0; t < NTUBES; t++) {
        eq[t] = IsEqual();
        eq[t].in[0] <== t;
        eq[t].in[1] <== idx;

        for (var i = 0; i < CAP; i++) {
            part[t][i] <== eq[t].out * state[t * CAP + i];
            acc[t + 1][i] <== acc[t][i] + part[t][i];
        }
    }

    for (var i = 0; i < CAP; i++) {
        slots[i] <== acc[NTUBES][i];
    }
}

// Tube summary under contiguous-fill assumption.
template TubeTop(CAP) {
    signal input slots[CAP];
    signal output filled[CAP];
    signal output height;
    signal output topColor;
    signal output topIndex;

    component isZ[CAP];
    signal hAcc[CAP + 1];
    hAcc[0] <== 0;

    for (var i = 0; i < CAP; i++) {
        isZ[i] = IsZero();
        isZ[i].in <== slots[i];
        filled[i] <== 1 - isZ[i].out;
        hAcc[i + 1] <== hAcc[i] + filled[i];
    }
    height <== hAcc[CAP];

    component eqH[CAP];
    signal colSel[CAP];
    signal idxSel[CAP];
    signal cAcc[CAP + 1];
    signal iAcc[CAP + 1];
    cAcc[0] <== 0;
    iAcc[0] <== 0;

    for (var i = 0; i < CAP; i++) {
        eqH[i] = IsEqual();
        eqH[i].in[0] <== i + 1;
        eqH[i].in[1] <== height;
        colSel[i] <== eqH[i].out * slots[i];
        idxSel[i] <== eqH[i].out * i;
        cAcc[i + 1] <== cAcc[i] + colSel[i];
        iAcc[i + 1] <== iAcc[i] + idxSel[i];
    }

    topColor <== cAcc[CAP];
    topIndex <== iAcc[CAP];
}

// Validate PUBLIC initial board for this game profile.
template ValidateInitial(NTUBES, CAP, NCOLORS, EMPTY_TUBES, COLOR_BITS) {
    signal input state[NTUBES * CAP];

    // Cell values must be integers in [0, NCOLORS].
    component inRange[NTUBES * CAP];
    for (var k = 0; k < NTUBES * CAP; k++) {
        inRange[k] = LessThan(COLOR_BITS);
        inRange[k].in[0] <== state[k];
        inRange[k].in[1] <== NCOLORS + 1;
        inRange[k].out === 1;
    }

    // No gaps within any tube.
    component isZ[NTUBES][CAP];
    signal filled[NTUBES][CAP];
    for (var t = 0; t < NTUBES; t++) {
        for (var i = 0; i < CAP; i++) {
            isZ[t][i] = IsZero();
            isZ[t][i].in <== state[t * CAP + i];
            filled[t][i] <== 1 - isZ[t][i].out;
        }
        for (var i = 0; i < CAP - 1; i++) {
            filled[t][i + 1] * (1 - filled[t][i]) === 0;
        }
    }

    // Exactly EMPTY_TUBES empty tubes.
    component top[NTUBES];
    component isEmptyTube[NTUBES];
    signal emptyAcc[NTUBES + 1];
    emptyAcc[0] <== 0;
    for (var t = 0; t < NTUBES; t++) {
        top[t] = TubeTop(CAP);
        for (var i = 0; i < CAP; i++) {
            top[t].slots[i] <== state[t * CAP + i];
        }
        isEmptyTube[t] = IsZero();
        isEmptyTube[t].in <== top[t].height;
        emptyAcc[t + 1] <== emptyAcc[t] + isEmptyTube[t].out;
    }
    emptyAcc[NTUBES] === EMPTY_TUBES;

    // Each color 1..NCOLORS appears exactly CAP times.
    component eqColor[NCOLORS][NTUBES * CAP];
    signal colorAcc[NCOLORS][NTUBES * CAP + 1];

    for (var c = 0; c < NCOLORS; c++) {
        colorAcc[c][0] <== 0;
        for (var k = 0; k < NTUBES * CAP; k++) {
            eqColor[c][k] = IsEqual();
            eqColor[c][k].in[0] <== state[k];
            eqColor[c][k].in[1] <== c + 1;
            colorAcc[c][k + 1] <== colorAcc[c][k] + eqColor[c][k].out;
        }
        colorAcc[c][NTUBES * CAP] === CAP;
    }
}

// Apply one move with app semantics: maximal contiguous top-run pour.
template ApplyMove(NTUBES, CAP, TUBE_BITS, IDX_BITS) {
    signal input stateIn[NTUBES * CAP];
    signal input src;
    signal input dst;
    signal input active;
    signal output stateOut[NTUBES * CAP];

    active * (active - 1) === 0;

    // Enforce src/dst indices are valid whenever move is active.
    component srcInRange = LessThan(TUBE_BITS);
    srcInRange.in[0] <== src;
    srcInRange.in[1] <== NTUBES;

    component dstInRange = LessThan(TUBE_BITS);
    dstInRange.in[0] <== dst;
    dstInRange.in[1] <== NTUBES;

    active * (1 - srcInRange.out) === 0;
    active * (1 - dstInRange.out) === 0;

    component srcSel = TubeSelect(NTUBES, CAP);
    component dstSel = TubeSelect(NTUBES, CAP);
    for (var k = 0; k < NTUBES * CAP; k++) {
        srcSel.state[k] <== stateIn[k];
        dstSel.state[k] <== stateIn[k];
    }
    srcSel.idx <== src;
    dstSel.idx <== dst;

    component srcTop = TubeTop(CAP);
    component dstTop = TubeTop(CAP);
    for (var i = 0; i < CAP; i++) {
        srcTop.slots[i] <== srcSel.slots[i];
        dstTop.slots[i] <== dstSel.slots[i];
    }

    // Compute maximal contiguous top run length in source.
    component eqTop[CAP];
    component isTopIndex[CAP];
    signal inRun[CAP];
    signal topEqFilled[CAP];
    signal topGate[CAP];
    signal runAcc[CAP + 1];
    runAcc[0] <== 0;

    for (var i = 0; i < CAP; i++) {
        eqTop[i] = IsEqual();
        eqTop[i].in[0] <== srcSel.slots[i];
        eqTop[i].in[1] <== srcTop.topColor;

        isTopIndex[i] = IsEqual();
        isTopIndex[i].in[0] <== i;
        isTopIndex[i].in[1] <== srcTop.topIndex;

        topEqFilled[i] <== srcTop.filled[i] * eqTop[i].out;
    }

    inRun[CAP - 1] <== topEqFilled[CAP - 1] * isTopIndex[CAP - 1].out;
    for (var i = CAP - 2; i >= 0; i--) {
        topGate[i] <== isTopIndex[i].out + inRun[i + 1];
        inRun[i] <== topEqFilled[i] * topGate[i];
    }
    for (var i = 0; i < CAP; i++) {
        runAcc[i + 1] <== runAcc[i] + inRun[i];
    }
    signal runLen;
    runLen <== runAcc[CAP];

    signal room;
    room <== CAP - dstTop.height;

    component runLtRoom = LessThan(IDX_BITS);
    runLtRoom.in[0] <== runLen;
    runLtRoom.in[1] <== room;

    signal amountLeft;
    signal amountRight;
    signal amount;
    amountLeft <== runLtRoom.out * runLen;
    amountRight <== (1 - runLtRoom.out) * room;
    amount <== amountLeft + amountRight;

    // Legality checks.
    component srcEmpty = IsZero();
    srcEmpty.in <== srcTop.height;
    signal srcOk;
    srcOk <== 1 - srcEmpty.out;

    component dstEmpty = IsZero();
    dstEmpty.in <== dstTop.height;

    component colorMatch = IsEqual();
    colorMatch.in[0] <== srcTop.topColor;
    colorMatch.in[1] <== dstTop.topColor;

    component colorOkOr = OR();
    colorOkOr.a <== dstEmpty.out;
    colorOkOr.b <== colorMatch.out;

    component roomPositive = IsZero();
    roomPositive.in <== room;
    signal hasRoom;
    hasRoom <== 1 - roomPositive.out;

    component sameTube = IsEqual();
    sameTube.in[0] <== src;
    sameTube.in[1] <== dst;
    signal notSame;
    notSame <== 1 - sameTube.out;

    signal validA;
    signal validB;
    signal valid;
    validA <== srcOk * colorOkOr.out;
    validB <== validA * hasRoom;
    valid <== validB * notSame;
    active * (1 - valid) === 0;

    // Range boundaries used by clear/fill ranges.
    signal srcStart;
    signal srcEnd;
    signal dstStart;
    signal dstEnd;
    srcStart <== srcTop.height - amount;
    srcEnd <== srcTop.height;
    dstStart <== dstTop.height;
    dstEnd <== dstTop.height + amount;

    component isSrc[NTUBES];
    component isDst[NTUBES];
    for (var t = 0; t < NTUBES; t++) {
        isSrc[t] = IsEqual();
        isSrc[t].in[0] <== t;
        isSrc[t].in[1] <== src;

        isDst[t] = IsEqual();
        isDst[t].in[0] <== t;
        isDst[t].in[1] <== dst;
    }

    // Update state: clear source top-run range and fill destination range.
    component iLtSrcStart[CAP];
    component iLtSrcEnd[CAP];
    component iLtDstStart[CAP];
    component iLtDstEnd[CAP];
    signal srcCellInRange[CAP];
    signal dstCellInRange[CAP];

    for (var i = 0; i < CAP; i++) {
        iLtSrcStart[i] = LessThan(IDX_BITS);
        iLtSrcStart[i].in[0] <== i;
        iLtSrcStart[i].in[1] <== srcStart;

        iLtSrcEnd[i] = LessThan(IDX_BITS);
        iLtSrcEnd[i].in[0] <== i;
        iLtSrcEnd[i].in[1] <== srcEnd;

        iLtDstStart[i] = LessThan(IDX_BITS);
        iLtDstStart[i].in[0] <== i;
        iLtDstStart[i].in[1] <== dstStart;

        iLtDstEnd[i] = LessThan(IDX_BITS);
        iLtDstEnd[i].in[0] <== i;
        iLtDstEnd[i].in[1] <== dstEnd;

        srcCellInRange[i] <== (1 - iLtSrcStart[i].out) * iLtSrcEnd[i].out;
        dstCellInRange[i] <== (1 - iLtDstStart[i].out) * iLtDstEnd[i].out;
    }

    signal isClear[NTUBES][CAP];
    signal isFill[NTUBES][CAP];
    signal keep[NTUBES][CAP];
    signal base[NTUBES][CAP];
    signal keptCell[NTUBES][CAP];
    signal filledCell[NTUBES][CAP];
    signal newCell[NTUBES][CAP];
    signal delta[NTUBES][CAP];

    for (var t = 0; t < NTUBES; t++) {
        for (var i = 0; i < CAP; i++) {
            base[t][i] <== stateIn[t * CAP + i];
            isClear[t][i] <== isSrc[t].out * srcCellInRange[i];
            isFill[t][i] <== isDst[t].out * dstCellInRange[i];
            keep[t][i] <== 1 - isClear[t][i] - isFill[t][i];

            keptCell[t][i] <== base[t][i] * keep[t][i];
            filledCell[t][i] <== srcTop.topColor * isFill[t][i];
            newCell[t][i] <== keptCell[t][i] + filledCell[t][i];
            delta[t][i] <== newCell[t][i] - base[t][i];
            stateOut[t * CAP + i] <== base[t][i] + active * delta[t][i];
        }
    }
}

// A tube is solved if empty or full monochrome.
template TubeOk(CAP) {
    signal input slots[CAP];
    signal output ok;

    component top = TubeTop(CAP);
    for (var i = 0; i < CAP; i++) {
        top.slots[i] <== slots[i];
    }

    component empty = IsZero();
    empty.in <== top.height;

    component full = IsEqual();
    full.in[0] <== top.height;
    full.in[1] <== CAP;

    component eq[CAP];
    signal sameAcc[CAP];
    sameAcc[0] <== 1;
    for (var i = 1; i < CAP; i++) {
        eq[i] = IsEqual();
        eq[i].in[0] <== slots[i];
        eq[i].in[1] <== slots[0];
        sameAcc[i] <== sameAcc[i - 1] * eq[i].out;
    }

    signal fullMono;
    fullMono <== full.out * sameAcc[CAP - 1];

    component fin = OR();
    fin.a <== empty.out;
    fin.b <== fullMono;
    ok <== fin.out;
}

template ColorSort(NTUBES, CAP, NMOVES, NCOLORS, EMPTY_TUBES, TUBE_BITS, IDX_BITS, COLOR_BITS) {
    signal input initial[NTUBES * CAP]; // public
    signal input srcs[NMOVES];          // private
    signal input dsts[NMOVES];          // private
    signal input active[NMOVES];        // private
    signal output moveCount;            // public output

    // Initial board soundness checks.
    component init = ValidateInitial(NTUBES, CAP, NCOLORS, EMPTY_TUBES, COLOR_BITS);
    for (var k = 0; k < NTUBES * CAP; k++) {
        init.state[k] <== initial[k];
    }

    // active[] is a boolean prefix of 1s then 0s.
    for (var m = 0; m < NMOVES; m++) {
        active[m] * (active[m] - 1) === 0;
    }
    for (var m = 0; m < NMOVES - 1; m++) {
        active[m + 1] * (1 - active[m]) === 0;
    }

    // Chain moves.
    signal states[NMOVES + 1][NTUBES * CAP];
    for (var k = 0; k < NTUBES * CAP; k++) {
        states[0][k] <== initial[k];
    }

    component step[NMOVES];
    for (var m = 0; m < NMOVES; m++) {
        step[m] = ApplyMove(NTUBES, CAP, TUBE_BITS, IDX_BITS);
        for (var k = 0; k < NTUBES * CAP; k++) {
            step[m].stateIn[k] <== states[m][k];
        }
        step[m].src <== srcs[m];
        step[m].dst <== dsts[m];
        step[m].active <== active[m];
        for (var k = 0; k < NTUBES * CAP; k++) {
            states[m + 1][k] <== step[m].stateOut[k];
        }
    }

    // Public move count.
    signal mcAcc[NMOVES + 1];
    mcAcc[0] <== 0;
    for (var m = 0; m < NMOVES; m++) {
        mcAcc[m + 1] <== mcAcc[m] + active[m];
    }
    moveCount <== mcAcc[NMOVES];

    // Final board must be solved.
    component ok[NTUBES];
    signal okAcc[NTUBES + 1];
    okAcc[0] <== 0;
    for (var t = 0; t < NTUBES; t++) {
        ok[t] = TubeOk(CAP);
        for (var i = 0; i < CAP; i++) {
            ok[t].slots[i] <== states[NMOVES][t * CAP + i];
        }
        okAcc[t + 1] <== okAcc[t] + ok[t].ok;
    }
    okAcc[NTUBES] === NTUBES;
}

// 12 tubes, cap 4, 10 colors, 2 empty tubes, up to 120 moves.
component main { public [initial] } = ColorSort(12, 4, 120, 10, 2, 4, 3, 5);
