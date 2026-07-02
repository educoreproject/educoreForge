### qtools-asynchronous-pipe

asynchronousPipe() takes an array of asynchronous functions and executes
them in sequence. As each completes, the next is called with the return
result of the previous function.

The purpose of the package is to create a joint scope for a series of
asynchronous operations.

There are two main functions:

```
const asynchronousPipePlus=require('qtools-asynchronous-pipe-plus')(); // Note function execution
const pipeRunner = asynchronousPipePlus.pipeRunner;
const taskListPlus = asynchronousPipePlus.taskListPlus;
```

It is executed like this:

```
const taskList = new taskListPlus();

taskList.push(someWorkListFunction);

pipeRunner(taskList.getList(), initialValue, [callback])
```

The parameters are:

    taskList:         an array of functions (This can be a normal Array())
    initialValue:    optional initial value passed to the first function
    callback:        optional function called after all the other functions are finished

The workList functions must have the signature:

    (args, next)={
        const result= "some functionOf(args), probably the result of an I/O function";
        next(err, result); //mandatory
    }

taskListPlus() returns, in addition to push() and getList(), several functions to control the parameters passed between process steps. These are undocumented for now:

*returnGlobalArgs, getArgsValue, enforceScope, reduceToLocalScope, restoreGlobalScope*

There is another taskListPlus() function that I used like crazy back in the day whose function is also, for now, undocumented: *addFromDelegate*.

#### UPDATE 6/7/19

There is a special value of err, **skipRestOfPipe**, eg:

```
next('skipRestOfPipe', result);
```

This will do as the symbol says, skip the rest of the pipe. It serves
the role of 'break' in loops. Practically speaking, it immediately calls the
callback function with the current value of result with the error value of 'skipRestOfPipe'.

It is often good to have special code in the final callback to change a
skipRestOfPipe error status for the next callback in case it's not an
asynchronousPipe and  treats it as an error. 

Eg,

```
callback(err=='skipRestOfPipe'?'':err, result)
```

The optional callback function is called as:

    callback(err, result);

pipeRunner() does not return anything.

#### UPDATE: v1.04 (6/6/24)

There are two new utility functions:

    asynchronousPipePlus.mergeArgs
    asynchronousPipePlus.forwardArgs

These fabricate a callback that makes the args object available
to the rest of the process sequence.

**mergeArgs is used when a result is expected.** The result is added
to the 'args' object using a string parameter as the property name:

    const mergeArgs = (args, next, propertyName) => (err, result) =>
        next(err, {
            ...args,
            ...(propertyName ? { [propertyName]: result } : result)
        });

It is called like this:

    taskList.push((args, next) => {
        const {argsForFunction}=args;
        asyncFuncWithCallback(
            argsForFunction,
            mergeArgs(args, next, 'propertyNameForResult')
        );
    });
    
    
    taskList.push((args, next) => {
        const {propertyNameForResult, otherArgIfAny}=args;
    
        // ...
    });

**forwardArgs is used when no result parameter is expected:**

    const forwardArgs = ({ next, args }) => err => next(err, args);
    
    taskList.push((args, next) => {
        const {argsForFunction}=args;
        asyncFuncWithCallback(
            argsForFunction,
            forwardArgs({ next, args })
        );
    });
    
    
    taskList.push((args, next) => {
        const {otherArgIfAny}=args;
    
        // ...
    });

### ===================================

### Misc Example from test.js

#!/usr/local/bin/node
'use strict';

const asynchronousPipePlus = new require('qtools-asynchronous-pipe-plus')();
const pipeRunner = asynchronousPipePlus.pipeRunner;
const taskListPlus = asynchronousPipePlus.taskListPlus; 

 const pipeFunction = (inData, callback) => {
    const taskList = new taskListPlus();

    taskList.push((args, next) => {
        const localCallback = (err, localResult1) => {
            if (err == 'someParticularError') {
                next('skipRestOfPipe', err);
                return;
            }
            console.dir({ 'only inboundData so far': args });
    
            args.localResult1 = localResult1;
            next(err, args);
        };
        localCallback('', 'localResult1_value');
    });
    
    
    taskList.push((args, next) => {
        const localCallback = (err, localResult3) => {
            args.localResult3 = localResult3;
            next(err, args);
        };
        console.dir({ 'shows localResult1 and inboundData': args });
        localCallback('', 'localResult3_value');
    });
    
    taskList.push(
        (args, next) => {
            const localCallback = (err, localResult2) => {
                args.localResult2 = localResult2;
                next(err, args);
            };
            console.dir({ 'shows localResult1 only': args });
            localCallback('', 'localResult2_value');
        },
        ['localResult1']
    );
    
    taskList.push(taskList.restoreGlobalScope());
    
    taskList.push((args, next) => {
        const localCallback = (err, localResult3) => {
            args.localResult3 = localResult3;
            next(err, args);
        };
        console.dir({ 'shows all incoming values, 1, 2, hiding test': args });
        localCallback('', 'localResult3_value');
    });
    
    taskList.push(
        (args, next) => {
            const localCallback = (err, localResult4) => {
                args.localResult4 = localResult4;
                next(err, args);
            };
            console.dir({ 'shows localResult1 and inboundData': args });
            localCallback('', 'localResult2_value');
        },
        ['localResult3', 'inboundData']
    );
    
    const initialData = typeof inData != 'undefined' ? inData : {};
    pipeRunner(taskList.getList(), initialData, (err, finalResult) => {
        console.dir({ 'final: shows localResult3, inboundData, and localResult4': finalResult });
        callback(err, finalResult);
    });

};

pipeFunction({ inboundData: 'inboundData_value' }, (err, result) => {
    console.log('if you do not see errors, it works');
});
