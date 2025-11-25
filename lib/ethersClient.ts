import { ethers } from "ethers";
import { tokenFactoryAbi } from "./abi/TokenFactory";

export const getBrowserProvider = () => {
  if (typeof window === "undefined" || !(window as any).ethereum) {
    throw new Error("No injected wallet found");
  }
  return new ethers.BrowserProvider((window as any).ethereum);
};

export const getFactoryContract = async () => {
  const factoryAddress = process.env.NEXT_PUBLIC_FACTORY_ADDRESS!;
  const provider = await getBrowserProvider();
  const signer = await provider.getSigner();
  console.log("here1--->", factoryAddress)
  return new ethers.Contract(factoryAddress, tokenFactoryAbi, signer);
};

export const getFactoryReadOnly = () => {
  const factoryAddress = process.env.NEXT_PUBLIC_FACTORY_ADDRESS!;
  const rpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC!;
  console.log("rpc------>",rpc)
  const provider = new ethers.JsonRpcProvider(rpc);
  return new ethers.Contract(factoryAddress, tokenFactoryAbi, provider);
};
