import { SubstrateExtrinsic, SubstrateEvent, SubstrateBlock, } from "@subql/types";
import { AccountId20, Voted, PreImageNoted, Proposed, Seconded, Tabled, Passed, NotPassed, Executed, ProposalCanceled, ReferendumCanceled, 
         RemoveVoteCall, UnlockCall,
         ActiveProposalsReferendaList
        } from "../types";
import {Balance, Vote } from "@polkadot/types/interfaces";
import { hexToNumber, hexToBigInt } from '@polkadot/util'; // Some helper functions used here




const updateProposalList = async (id, timestamp, blockNum) => {
  let record =  new ActiveProposalsReferendaList(id);
  record.blockNum = blockNum;
  record.now = (await api.query.timestamp.now()).toString();
  record.timestamp = timestamp;

  const lowestUnbaked = await api.query.democracy.lowestUnbaked();
  const referendumCount = await api.query.democracy.referendumCount();  //remember to loop to this minus 1
  record.lowestUnbaked = lowestUnbaked.toString();
  record.referendumCount = referendumCount.toString();


  const publicProps = (await api.query.democracy.publicProps()).toJSON() as any; 
  //publicProps:  [[189, 0x9747006a3e0919156873c4cce0d8f3e289ce8d9d863b4e2ce155c924df8419f7, 0xB9A6817688FaC3E2E0955bb9B595E119E3c1000A]]
  // propIndex, proposalHash, accountMadeProposal
  // logger.info(`||||||||| >>>>>>>> typeof publicProps ${typeof publicProps} ${publicProps.constructor===Array} publicProps: `, publicProps);
  // record.publicProps = publicProps;
  record.publicPropsLength = publicProps.length;
  
  
  const buildPubliProps = async (_publicProps) => {
    const proposalsLength = _publicProps.length;
    let counter = 0;
    let _proposalList = [];

    const analyseProposal = async (propos) => {
        const [propIndex, propHash, proposerAcccount] = propos;

        logger.info(`||||||||| >>>>>>>> depositOf <<<<|||||`);
        const depositOf = (await api.query.democracy.depositOf(propIndex)).toJSON() as any;
        const depositOfJSON = JSON.stringify(depositOf);
        // // depositOf:  [["0xB9A6817688FaC3E2E0955bb9B595E119E3c1000A","0xB9A6817688FaC3E2E0955bb9B595E119E3c1000A"],"0x00000000000000003782dace9d900000"]
        // //[arrayOfBackerAccounts], AmountinHex
        
        // const propHashString = propHash.toString();
        logger.info(`||||||||| >>>>>>>> PreImages <<<<|||||`);
        const preImages = (await api.query.democracy.preimages(propHash)).toJSON() as any;
        const preImagesJSON = JSON.stringify(preImages);
        // preImages:  {"available":
        //                           {
        //                           "data":"0x000185014d617468656d61746963732072657665616c73206974732073656372657473206f6e6c7920746f2074686f73652077686f20617070726f61636820697420776974682070757265206c6f76652c20666f7220697473206f776e206265617574792e",
        //                           "provider":"0xB9A6817688FaC3E2E0955bb9B595E119E3c1000A",
        //                           "deposit":"0x00000000000000000023e1e5803b4000",
        //                           "since":2864515,
        //                           "expiry":null
        //                         }
        //              }
    
        _proposalList.push(
                            {
                              propIndex,
                              propHash,
                              proposerAcccount,
                              depositOf: depositOfJSON,
                              preImages: preImagesJSON
                            }
                          )
        ++counter
        if (counter<proposalsLength) analyseProposal(_publicProps[counter])
        else { 
          logger.info(`||||||||| >>>>>>>> End of buildPubliProps <<<<|||||`);
          record.proposalList = JSON.stringify(_proposalList);
        }

    }

    if (proposalsLength > 0) analyseProposal(_publicProps[counter])
  }


  await buildPubliProps(publicProps); 
  
  let referendaArray = [];
  for (let i=Number(lowestUnbaked); i<Number(referendumCount); i++)
  {
    logger.info(`||||||||| >>>>>>>> referendumInfo <<<<|||||`);
    const referendumInfo = (await api.query.democracy.referendumInfoOf(i)).toJSON() as any;
    // referendumInfo:  {"ongoing":
    //                     {
    //                     "end":2872800,
    //                     "proposalHash":"0x90404a489088472ad3b8b7508be1f8c86664e444f0a4f3c2dfa3ae894357724b",
    //                     "threshold":"SuperMajorityApprove",
    //                     "delay":7500,
    //                     "tally":{
    //                               "ayes":0,
    //                               "nays":"0x0000000000000000002bd72a24874000",
    //                               "turnout":"0x000000000000000001b667a56d488000"
    //                             }
    //                     }
    //                   }

    const refrendumEndBlock = referendumInfo.ongoing["end"];
    const refrendumProposalHash = referendumInfo.ongoing["proposalHash"];              
    const refrendumDelay = referendumInfo.ongoing["delay"];              
    const refrendumTally = {
                        ayes   : (hexToBigInt(referendumInfo.ongoing["tally"]["ayes"])).toString(), 
                        nays   : (hexToBigInt(referendumInfo.ongoing["tally"]["nays"])).toString(),
                        turnout: (hexToBigInt(referendumInfo.ongoing["tally"]["turnout"])).toString()
                      }
    referendaArray.push({ referendumIndex: i, refrendumEndBlock, refrendumProposalHash, refrendumDelay, refrendumTally,});             

  }
  record.referendaArray = JSON.stringify(referendaArray);

  await record.save();
}


//#region onChainVotingDataInteprator Object
//source: https://wiki.polkadot.network/docs/maintain-guides-democracy
const onChainVotingDataInteprator ={
  "0": "Nay 0.1x",
  "1": "Nay 1x",
  "2": "Nay 2x",
  "3": "Nay 3x",
  "4": "Nay 4x",
  "5": "Nay 5x",
  "6": "Nay 6x",
  "128":"Aye 0.1x",
  "129": "Aye 1x",
  "130": "Aye 2x",
  "131": "Aye 3x",
  "132": "Aye 4x",
  "133": "Aye 5x",
  "134": "Aye 6x",
}
//#endregion


//#region handleVotedEvent
export async function handleVotedEvent(event: SubstrateEvent): Promise<void> {
  const {event: {data: [account, refIndex, voteObj]}} = event;
  let record = new Voted(`${event.block.block.header.number.toNumber()}-${event.idx}`);
  record.blockNum = event.block.block.header.number.toNumber();
  record.timestamp = event.block.timestamp;
  record.extrinsicHash =  event.extrinsic.extrinsic.hash.toString();
  
  //Retrieve the record by its ID
  const account_Id20 = await AccountId20.get(account.toString());
  if ( !account_Id20 )
  {
    await new AccountId20( account.toString() ).save();
  }
  record.voterAccountId = account.toString();
  
  record.refIndex = refIndex.toString()
  
  const newVote  =  voteObj.toJSON() as any;
  const newVote_Objkeys  =  Object.keys( newVote );
  if (newVote_Objkeys.includes("standard"))
  {
    logger.info(`\n ===> newVote_Objkeys DOES include standard ===> `);
    record.voteTypeStandard = true;
    
    const vote = (newVote["standard"]["vote"] as Vote);
    // record.vote = vote.toString();
    const voteHexNum = hexToNumber(vote.toString()).toString()
    record.voteConvictionNum = voteHexNum;
    const voteDescriptionSplit = (onChainVotingDataInteprator[voteHexNum]).split(" ");
    record.voteLock = voteDescriptionSplit[1];
    const voteDirection = voteDescriptionSplit[0];
    record.voteDirection = voteDirection;
    if (voteDirection==="Aye") {
      record.voteAye = true;
      record.voteNay = false;
    }
    else {
      record.voteAye = false;
      record.voteNay = true;
    }
    
    const balance = (newVote["standard"]["balance"] as Balance).toString();
    record.voteBalance = hexToBigInt(balance);
  }
  else 
  {
    logger.info(`\n ===> newVote_Objkeys does not include standard ===> `);
    record.voteTypeStandard = false;
  }
  
  logger.info(`\n ********************************************* `);
  record.eventPayload = (event.event.data.toJSON() as any).toString();
  logger.info(`\n ********************************************* `);

  
  await updateProposalList(`${event.block.block.header.number.toNumber()}-${event.idx}`, record.timestamp, record.blockNum);

  await record.save();
}
//#endregion handleVotedEvent


//#region handlePreImageNotedEvent
export async function handlePreImageNotedEvent(event: SubstrateEvent): Promise<void> {
  const [proposalHash, account, amount] = event.event.data.toJSON() as any;
  
  let record = new PreImageNoted(`${event.block.block.header.number.toNumber()}-${event.idx}`);
  record.blockNum = event.block.block.header.number.toNumber();
  record.timestamp = event.block.timestamp;
  record.extrinsicHash =  event.extrinsic.extrinsic.hash.toString();
  
  //Retrieve the record by its ID
  const account_Id20 = await AccountId20.get(account.toString());
  if ( !account_Id20 )
  {
    await new AccountId20( account.toString() ).save();
  }
  record.preImageAccountId = account.toString();
  record.preImageHash = proposalHash.toString();
  
  const balance = (amount as Balance).toString();
  record.preImageStorageFees = hexToBigInt(balance);
  
  logger.info(`\n ********************************************* `);
  record.eventPayload = (event.event.data.toJSON() as any).toString();
  logger.info(`\n ********************************************* `);

  await record.save();
}
//#endregion handlePreImageNotedEvent


//#region handleProposedEvent
export async function handleProposedEvent(event: SubstrateEvent): Promise<void> {
  const [proposalIndex, deposit] = event.event.data.toJSON() as any;
  
  let record = new Proposed(`${event.block.block.header.number.toNumber()}-${event.idx}`);
  record.blockNum = event.block.block.header.number.toNumber();
  record.timestamp = event.block.timestamp;
  record.extrinsicHash =  event.extrinsic.extrinsic.hash.toString();
  record.proposalIndex = proposalIndex;
  
  const balance = (deposit as Balance).toString();
  record.proposalDeposit = hexToBigInt(balance);
  
  const nEv = event.extrinsic.events.length;
  for (let i=0; i<nEv; i++) 
  {
    if (  (event.extrinsic.events[i].event.section).toLowerCase() ==="balances" && (event.extrinsic.events[i].event.method).toLowerCase() ==="reserved")
    {
      const [account, amount] = event.extrinsic.events[i].event.data.toJSON() as any;
      //Retrieve the record by its ID
      const account_Id20 = await AccountId20.get(account.toString());
      if ( !account_Id20 )
      {
        await new AccountId20( account.toString() ).save();
      }
      record.proposalAccountId = account.toString();
    }
  }
  
  logger.info(`\n ********************************************* `);
  record.eventPayload = (event.event.data.toJSON() as any).toString();
  logger.info(`\n ********************************************* `);

  await updateProposalList(`${event.block.block.header.number.toNumber()}-${event.idx}`, record.timestamp, record.blockNum);

  await record.save();
}
//#endregion handleProposedEvent


//#region handleSecondedEvent
export async function handleSecondedEvent(event: SubstrateEvent): Promise<void> {
  const [account, propIndex] = event.event.data.toJSON() as any;
  
  let record = new Seconded(`${event.block.block.header.number.toNumber()}-${event.idx}`);
  record.blockNum = event.block.block.header.number.toNumber();
  record.timestamp = event.block.timestamp;
  record.extrinsicHash =  event.extrinsic.extrinsic.hash.toString();
  record.proposalIndex = propIndex;
  
  //Retrieve the record by its ID
  const account_Id20 = await AccountId20.get(account.toString());
  if ( !account_Id20 )
  {
    await new AccountId20( account.toString() ).save();
  }
  record.seconderAccountId = account.toString();
  
  const nEv = event.extrinsic.events.length;
  for (let i=0; i<nEv; i++) 
  {
    if (  (event.extrinsic.events[i].event.section).toLowerCase() ==="balances" && (event.extrinsic.events[i].event.method).toLowerCase() ==="reserved")
    {
      const [account, amount] = event.extrinsic.events[i].event.data.toJSON() as any;
      const balance = (amount as Balance).toString();
      record.secondedAmount = hexToBigInt(balance);
    }
  }
  
  logger.info(`\n ********************************************* `);
  record.eventPayload = (event.event.data.toJSON() as any).toString();
  logger.info(`\n ********************************************* `);

  await updateProposalList(`${event.block.block.header.number.toNumber()}-${event.idx}`, record.timestamp, record.blockNum);

  await record.save();
}
//#endregion handleSecondedEvent


//#region handleTabledEvent
export async function handleTabledEvent(event: SubstrateEvent): Promise<void> {
    const [proposalIndex, depositAmount, depositors] = event.event.data.toJSON() as any;
    logger.info(`\n ********************************************* `);
    let arrayOfDepositors = [];
    depositors.forEach((element) => {
      arrayOfDepositors.push(element.toString())
    })

    let referendumIndex;
    const nEv = event.block.events.length;
    for (let i=0; i<nEv; i++) 
    {
        if (  (event.block.events[i].event.section).toLowerCase() ==="democracy" && (event.block.events[i].event.method).toLowerCase() ==="started")
        {
            const [refIndex, threshold] = event.block.events[i].event.data.toJSON() as any;
            referendumIndex = refIndex;
        }
        // logger.info(`\n =======> SECTION: ${event.block.events[i].event.section} METHOD:${event.block.events[i].event.method} ********************************************* `);
    }
    
    let record = new Tabled(`${event.block.block.header.number.toNumber()}-${event.idx}`);
    record.referendumIndex = referendumIndex;
    record.depositors = arrayOfDepositors;
    record.proposalIndex = proposalIndex;
    const balance = (depositAmount as Balance).toString();
    record.depositAmount = hexToBigInt(balance);
    record.blockNum = event.block.block.header.number.toNumber();
    record.timestamp = event.block.timestamp;
    
    logger.info(`\n ********************************************* `);
    record.eventPayload = (event.event.data.toJSON() as any).toString();
    logger.info(`\n ********************************************* `);

    await updateProposalList(`${event.block.block.header.number.toNumber()}-${event.idx}`, record.timestamp, record.blockNum);

    await record.save();
}
//#endregion handleTabledEvent


//#region handlePassedEvent
export async function handlePassedEvent(event: SubstrateEvent): Promise<void> {
    const [refIndex] = event.event.data.toJSON() as any;

    let record = new Passed(`${event.block.block.header.number.toNumber()}-${event.idx}`);

    let scheduledEnactmentBlock;
     const nEv = event.block.events.length;
    for (let i=0; i<nEv; i++) 
    {
        if (  (event.block.events[i].event.section).toLowerCase() ==="scheduler" && (event.block.events[i].event.method).toLowerCase() ==="scheduled")
        {
            const [whenBlock, index] = event.block.events[i].event.data.toJSON() as any;
            scheduledEnactmentBlock = whenBlock.toString();
        }
        // logger.info(`\n =======> SECTION: ${event.block.events[i].event.section} METHOD:${event.block.events[i].event.method} ********************************************* `);
    }
    record.scheduledEnactmentBlock = scheduledEnactmentBlock;
    record.referendumIndex = refIndex;
    record.blockNum = event.block.block.header.number.toNumber();
    record.timestamp = event.block.timestamp;

    logger.info(`\n ********************************************* `);
    record.eventPayload = (event.event.data.toJSON() as any).toString();
    logger.info(`\n ********************************************* `);

    await updateProposalList(`${event.block.block.header.number.toNumber()}-${event.idx}`, record.timestamp, record.blockNum);

    await record.save();
}
//#endregion handlePassedEvent



//#region handleNotPassedEvent
export async function handleNotPassedEvent(event: SubstrateEvent): Promise<void> {
  const [refIndex] = event.event.data.toJSON() as any;

  let record = new NotPassed(`${event.block.block.header.number.toNumber()}-${event.idx}`);
  record.referendumIndex = refIndex;
  record.blockNum = event.block.block.header.number.toNumber();
  record.timestamp = event.block.timestamp;

  logger.info(`\n NotPassed ********************************************* `);
  record.eventPayload = (event.event.data.toJSON() as any).toString();
  logger.info(`\n NotPassed ********************************************* `);

  await updateProposalList(`${event.block.block.header.number.toNumber()}-${event.idx}`, record.timestamp, record.blockNum);

  await record.save();
}
//#endregion handleNotPassedEvent


//#region handleExecutedEvent
export async function handleExecutedEvent(event: SubstrateEvent): Promise<void> {
  const [refIndex, result] = event.event.data.toJSON() as any;

  let record = new Executed(`${event.block.block.header.number.toNumber()}-${event.idx}`);
  record.referendumIndex = refIndex;
  record.result = JSON.stringify(result);

  const nEv = event.block.events.length;
  for (let i=0; i<nEv; i++) 
  {
      if (  (event.block.events[i].event.section).toLowerCase() ==="democracy" && (event.block.events[i].event.method).toLowerCase() ==="preimageused")
      {
          const [proposalHash, providerAccount, refundedAmount] = event.block.events[i].event.data.toJSON() as any;
          record.proposalHash = proposalHash.toString();
          record.providerAccount = providerAccount.toString();
          record.refundedAmountString = refundedAmount.toString();
          const balance = (refundedAmount as Balance).toString();
          record.refundedAmount = hexToBigInt(balance);

      }
      // logger.info(`\n =======> SECTION: ${event.block.events[i].event.section} METHOD:${event.block.events[i].event.method} ********************************************* `);
  }

  record.blockNum = event.block.block.header.number.toNumber();
  record.timestamp = event.block.timestamp;

  logger.info(`\n Executed ********************************************* `);
  record.eventPayload = (event.event.data.toJSON() as any).toString();
  logger.info(`\n Executed ********************************************* `);

  await record.save();
}
//#endregion handleExecutedEvent


//#region handleProposalCanceledEvent
export async function handleProposalCanceledEvent(event: SubstrateEvent): Promise<void> {
  // const [refIndex] = event.event.data.toJSON() as any;
  let record = new ProposalCanceled(`${event.block.block.header.number.toNumber()}-${event.idx}`);
  record.blockNum = event.block.block.header.number.toNumber();
  record.timestamp = event.block.timestamp;

  // let scheduledEnactmentBlock;
   const nEv = event.block.events.length;
  for (let i=0; i<nEv; i++) 
  {
      // if (  (event.block.events[i].event.section).toLowerCase() ==="scheduler" && (event.block.events[i].event.method).toLowerCase() ==="scheduled")
      // {
      //     const [whenBlock, index] = event.block.events[i].event.data.toJSON() as any;
      //     scheduledEnactmentBlock = whenBlock.toString();
      // }
      logger.info(`\n =======> SECTION: ${event.block.events[i].event.section} METHOD:${event.block.events[i].event.method} ********************************************* `);
  }


  logger.info(`\n ProposalCanceled ********************************************* `);
  record.eventPayload = (event.event.data.toJSON() as any).toString();
  logger.info(`\n ProposalCanceled ********************************************* `);

  await record.save();
}
//#endregion handleProposalCanceledEvent


//#region handleReferendumCanceledEvent
export async function handleReferendumCanceledEvent(event: SubstrateEvent): Promise<void> {
  // const [refIndex] = event.event.data.toJSON() as any;
  let record = new ReferendumCanceled(`${event.block.block.header.number.toNumber()}-${event.idx}`);
  record.blockNum = event.block.block.header.number.toNumber();
  record.timestamp = event.block.timestamp;

  logger.info(`\n ReferendumCanceled ********************************************* `);
  record.eventPayload = (event.event.data.toJSON() as any).toString();
  logger.info(`\n ReferendumCanceled ********************************************* `);

  await updateProposalList(`${event.block.block.header.number.toNumber()}-${event.idx}`, record.timestamp, record.blockNum);

  await record.save();
}
//#endregion handleReferendumCanceledEvent

//#region handleRemoveVoteCall
export async function handleRemoveVoteCall(extrinsic: SubstrateExtrinsic): Promise<void> {

  let record = new RemoveVoteCall(`${extrinsic.extrinsic.hash.toString()}`);
  record.blockNum =  extrinsic.block.block.header.number.toNumber();
  record.timestamp = extrinsic.block.timestamp;

  const account =  extrinsic.extrinsic.signer;
  //Retrieve the record by its ID
  const account_Id20 = await AccountId20.get(account.toString());
  if ( !account_Id20 )
  {
    await new AccountId20( account.toString() ).save();
  }
  record.signerAccountId = account.toString();
  // record.signature     = extrinsic.extrinsic.signature.toString();
 
  logger.info(`\n RemoveVoteCall ********************************************* `);
  // record.extrinsicPayloadHex = (extrinsic.extrinsic.method.toHex() as any).toString();
  const {callIndex, args} =   extrinsic.extrinsic.method.toJSON() as any;
  record.argsIndex = args["index"].toString();
  logger.info("\n ====> RemoveVoteCall ==>  args" + JSON.stringify(args)); 
  // ====> RemoveVoteCall ==>  args{"index":109} 
  logger.info(`\n RemoveVoteCall ********************************************* `);

  await updateProposalList(`${extrinsic.extrinsic.hash.toString()}`, record.timestamp, record.blockNum);

  await record.save();
}
//#endregion handleRemoveVoteCall


//#region handleUnlockCall
export async function handleUnlockCall(extrinsic: SubstrateExtrinsic): Promise<void> {

  let record = new UnlockCall(`${extrinsic.extrinsic.hash.toString()}`);
  record.blockNum =  extrinsic.block.block.header.number.toNumber();
  record.timestamp = extrinsic.block.timestamp;

  let account =  extrinsic.extrinsic.signer;
  //Retrieve the record by its ID
  let account_Id20 = await AccountId20.get(account.toString());
  if ( !account_Id20 )
  {
    await new AccountId20( account.toString() ).save();
  }
  record.signerAccountId = account.toString();

  logger.info(`\n UnlockCall ********************************************* `);
  const {callIndex, args} =   extrinsic.extrinsic.method.toJSON() as any;

  account = args["target"];
  //Retrieve the record by its ID
  account_Id20 = await AccountId20.get(account.toString());
  if ( !account_Id20 )
  {
    await new AccountId20( account.toString() ).save();
  }
  record.argsTargetAccountId = account.toString();
  logger.info("\n ====> UnlockCall ==>  args" + JSON.stringify(args)); 
  // |  ====> UnlockCall ==>  args{"target":"0x8aC171C7BEa586d84C166BECdd6284B05A682000"} 
  logger.info(`\n unlockCall ********************************************* `);

  await record.save();
}
//#endregion handleUnlockCall

