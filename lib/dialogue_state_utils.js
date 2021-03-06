// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

function isExecutable(stmt) {
    let hasUndefined = false;
    const visitor = new class extends Ast.NodeVisitor {
        visitValue(value) {
            if (value.isUndefined)
                hasUndefined = true;
            return true;
        }
    };
    stmt.visit(visitor);
    return !hasUndefined;
}

function shouldAutoConfirmStatement(stmt) {
    if (stmt.isRule)
        return false;

    let needsConfirm = false;
    const visitor = new class extends Ast.NodeVisitor {
        visitInvocation(value) {
            if (value.schema.annotations.confirm)
                needsConfirm = needsConfirm || value.schema.annotations.confirm.toJS();
            else
                needsConfirm = needsConfirm || value.schema.functionType === 'action';
            return true;
        }
    };
    stmt.visit(visitor);
    return !needsConfirm;
}

function computeNewState(state, prediction, forTarget) {
    const clone = new Ast.DialogueState(null, prediction.policy, prediction.dialogueAct, prediction.dialogueActParam, []);

    // append all history elements that were confirmed
    if (state !== null) {
        for (let oldItem of state.history) {
            if (oldItem.confirm !== 'confirmed')
                break;
            clone.history.push(oldItem);
        }
    }

    const autoConfirm = forTarget === 'user';
    // append the prediction items, and set the confirm bit if necessary
    for (let newItem of prediction.history) {
        let cloneItem = newItem;
        if (cloneItem.confirm === 'accepted' && autoConfirm && isExecutable(cloneItem.stmt) && shouldAutoConfirmStatement(cloneItem.stmt)) {
            cloneItem = cloneItem.clone();
            cloneItem.confirm = 'confirmed';
        }
        clone.history.push(cloneItem);
    }

    return clone;
}

function prepareContextForPrediction(context, forTarget) {
    const clone = new Ast.DialogueState(null, context.policy, context.dialogueAct, context.dialogueActParam, []);

    // walk through all items in the history, find the last with results

    let i, lastItem;
    for (i = 0; i < context.history.length; i++) {
        const item = context.history[i];
        if (item.results === null)
            break;
        lastItem = item;
    }

    // add a copy of the last item with results, and trim the result list to 1 or 3
    if (lastItem) {
        const cloneItem = lastItem.clone();
        if (forTarget === 'user' && cloneItem.results.results.length > 1)
            cloneItem.results.results.length = 1;
        else if (cloneItem.results.results.length > 3)
            cloneItem.results.results.length = 3;
        clone.history.push(cloneItem);
    }

    // append the unconfirmed/unexecuted results
    for (; i < context.history.length; i++) {
        const item = context.history[i];
        assert(item.results === null);

        // about this assertion:
        //
        // on the agent side, we just executed the state, so all confirmed statements
        // must have results
        //
        // on the user side, the agent just spoke; the agent never introduces confirmed statements,
        // because statements must be confirmed by the user, so this assertion is also true
        assert(item.confirm !== 'confirmed');

        clone.history.push(item);
    }

    return clone;
}

module.exports = {
    isExecutable,
    shouldAutoConfirmStatement,

    computeNewState,
    prepareContextForPrediction,
};
